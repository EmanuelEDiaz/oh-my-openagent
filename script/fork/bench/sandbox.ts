/**
 * Isolated OpenCode for the bench: its own HOME and XDG roots, the plugin under test, the user's model choices
 * (`/omo-models` → ~/.omo/omo.jsonc) and a copy of auth.json that is deleted with the sandbox. Never touches the real
 * config, data or opencode.db.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join, resolve, sep } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { parseJsonc } from "../../../packages/utils/src/jsonc-parser"

export type Sandbox = { readonly root: string; readonly env: Readonly<Record<string, string>> }

const REAL_HOME = homedir()

// Both the defaults and any XDG override: the guard must hold whichever one OpenCode would use.
function realRoots(): string[] {
  const roots = [
    REAL_HOME,
    join(REAL_HOME, ".config"),
    join(REAL_HOME, ".local/share"),
    join(REAL_HOME, ".local/state"),
    join(REAL_HOME, ".cache"),
    process.env.XDG_CONFIG_HOME,
    process.env.XDG_DATA_HOME,
    process.env.XDG_STATE_HOME,
    process.env.XDG_CACHE_HOME,
  ]
  return [...new Set(roots.filter((path): path is string => path !== undefined).map((path) => resolve(path)))]
}

/** The sandbox must be a fresh directory that is not, and does not contain, any real config/data root. */
export function assertSafeSandboxRoot(root: string): void {
  const target = resolve(root)
  for (const real of realRoots()) {
    if (target === real || real.startsWith(`${target}${sep}`)) throw new Error(`refusing sandbox at ${target}: it is or contains ${real}`)
    if (real !== REAL_HOME && target.startsWith(`${real}${sep}opencode`)) throw new Error(`refusing sandbox inside OpenCode's real ${real}/opencode`)
  }
  if (existsSync(target)) throw new Error(`refusing to reuse existing directory ${target}; pass a new one`)
}

function copyIfExists(from: string, to: string): void {
  if (existsSync(from)) cpSync(from, to, { recursive: true })
}

export function createSandbox(root: string, pluginEntry: string): Sandbox {
  assertSafeSandboxRoot(root)
  const dirs = ["home/.omo", "config/opencode", "data/opencode", "state", "cache/opencode", "work"]
  for (const dir of dirs) mkdirSync(join(root, dir), { recursive: true })
  const realConfig = join(process.env.XDG_CONFIG_HOME ?? join(REAL_HOME, ".config"), "opencode")
  // Installed plugin dependencies: without them the first start installs everything and takes minutes.
  for (const name of ["node_modules", "package.json", "package-lock.json"]) copyIfExists(join(realConfig, name), join(root, "config/opencode", name))
  copyIfExists(join(process.env.XDG_DATA_HOME ?? join(REAL_HOME, ".local/share"), "opencode/auth.json"), join(root, "data/opencode/auth.json"))
  copyIfExists(join(process.env.XDG_CACHE_HOME ?? join(REAL_HOME, ".cache"), "opencode/models.json"), join(root, "cache/opencode/models.json"))
  // The models the user picked with /omo-models: the bench measures what the user actually runs.
  copyIfExists(join(REAL_HOME, ".omo/omo.jsonc"), join(root, "home/.omo/omo.jsonc"))
  writeFileSync(
    join(root, "config/opencode/opencode.json"),
    // No file snapshots: the bench never undoes, and OpenCode would copy every task's repo into its data dir.
    JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [`file://${realpathSync(pluginEntry)}`], snapshot: false }, null, 2),
  )
  return {
    root,
    env: {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_STATE_HOME: join(root, "state"),
      XDG_CACHE_HOME: join(root, "cache"),
    },
  }
}

/** Fresh git repo with the fixture's files, so the agent's changes and git usage are observable. */
export function prepareWorkdir(sandbox: Sandbox, fixtureDir: string, name: string): string {
  const workdir = join(sandbox.root, "work", name)
  cpSync(fixtureDir, workdir, { recursive: true })
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-c", "user.name=bench", "-c", "user.email=bench@example.invalid", ...args], { cwd: workdir, env: { ...process.env, ...sandbox.env } })
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  }
  git("init", "-q")
  git("add", "-A")
  git("commit", "-qm", "fixture")
  return workdir
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolvePort(typeof address === "object" && address ? address.port : 0))
    })
  })
}

export type Server = { readonly baseUrl: string; stop(): void }

/** One `opencode serve` for the whole run; each task talks to it with its own workdir as `directory`. */
export async function startServer(sandbox: Sandbox, startupTimeoutMs = 600_000): Promise<Server> {
  const port = await freePort()
  const child: ChildProcess = spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: join(sandbox.root, "work"),
    env: { ...process.env, ...sandbox.env },
    stdio: "ignore",
    detached: true,
  })
  const stop = () => {
    // Kill the whole process group: opencode spawns LSP and MCP children that would otherwise outlive the run.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch {
        // already gone
      }
    }
  }
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + startupTimeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break
    if (await fetch(`${baseUrl}/config`).then((response) => response.ok, () => false)) return { baseUrl, stop }
    await Bun.sleep(1000)
  }
  stop()
  throw new Error(`server did not start within ${startupTimeoutMs / 1000}s`)
}

/**
 * The plugin writes its provider cache only after the first root session, and registers agents from that cache when
 * a directory is first opened. Without this warm-up every task would run as a first install, where configured models
 * cannot be verified. Returns whether the cache appeared.
 */
export async function warmUp(sandbox: Sandbox, server: Server, timeoutMs = 120_000): Promise<boolean> {
  const workdir = join(sandbox.root, "work", "warm-up")
  mkdirSync(workdir, { recursive: true })
  const client = createOpencodeClient({ baseUrl: server.baseUrl, directory: workdir })
  await client.session.create({ title: "bench warm-up" })
  const cacheFile = join(sandbox.env.XDG_CACHE_HOME ?? "", "oh-my-opencode/provider-models.json")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(cacheFile)) return true
    await Bun.sleep(1000)
  }
  return false
}

/** True when the server answers within the timeout. */
export async function isHealthy(server: Server, timeoutMs = 10_000): Promise<boolean> {
  return fetch(`${server.baseUrl}/config`, { signal: AbortSignal.timeout(timeoutMs) }).then((response) => response.ok, () => false)
}

/** Copies OpenCode's own logs out of the sandbox (never auth.json) before it is deleted. */
export function saveServerLogs(sandbox: Sandbox, to: string): void {
  const logs = join(sandbox.root, "data/opencode/log")
  if (existsSync(logs)) cpSync(logs, to, { recursive: true })
}

/**
 * Processes still running with the sandbox's HOME: background helpers the sandboxed OpenCode started and that outlive
 * it, such as the plugin's shared LSP daemon (idle for 30 min, ~500 MB with tsserver). Linux only (/proc); the bench is
 * a Linux/WSL dev tool.
 */
export function sandboxProcesses(root: string, procDir = "/proc"): number[] {
  if (!existsSync(procDir)) return []
  const home = `HOME=${join(root, "home")}`
  const found: number[] = []
  for (const entry of readdirSync(procDir)) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue
    try {
      if (readFileSync(join(procDir, entry, "environ"), "utf8").split("\0").includes(home)) found.push(Number(entry))
    } catch {
      // gone, or not ours to read
    }
  }
  return found
}

export function destroySandbox(sandbox: Sandbox): void {
  for (const pid of sandboxProcesses(sandbox.root)) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // already gone
    }
  }
  rmSync(sandbox.root, { recursive: true, force: true })
}

/**
 * Pins agents to models inside the sandbox's copy of omo.jsonc only (e.g. the same free model for two agents being
 * compared). The user's real configuration is never touched.
 */
export function overrideAgentModels(sandbox: Sandbox, overrides: Readonly<Record<string, string>>): void {
  if (Object.keys(overrides).length === 0) return
  const path = join(sandbox.root, "home/.omo/omo.jsonc")
  const config = (existsSync(path) ? parseJsonc<Record<string, unknown>>(readFileSync(path, "utf8")) : {}) ?? {}
  const scope = ((config["[opencode]"] as Record<string, unknown> | undefined) ?? (config["[opencode]"] = {})) as Record<string, unknown>
  const agents = ((scope["agents"] as Record<string, Record<string, unknown>> | undefined) ?? (scope["agents"] = {})) as Record<string, Record<string, unknown>>
  for (const [agent, model] of Object.entries(overrides)) {
    const { models: _models, fallback_models: _fallbacks, ...rest } = agents[agent] ?? {}
    agents[agent] = { ...rest, model }
  }
  writeFileSync(path, JSON.stringify(config, null, 2))
}
