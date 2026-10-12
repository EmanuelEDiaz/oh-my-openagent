#!/usr/bin/env bun
/**
 * Real-TUI driver for QA (fork roadmap rule 17): runs the user's real `opencode` TUI inside a private tmux server
 * (`-L omo-qa-<pid>`, never the user's own tmux) in an isolated XDG sandbox, types like the user, captures the screen and
 * reads OpenCode's own logs as evidence.
 *
 *   bun script/fork/qa/tui-driver.ts --plugin <dist/index.js> --steps steps.json [--evidence .omo/evidence/tui]
 *
 * steps.json: [{ "type": "text", "value": "/omo-models" }, { "type": "key", "value": "Enter" },
 *              { "type": "wait", "for": "Choose models", "timeoutMs": 20000 }, { "type": "capture", "name": "picker" },
 *              { "type": "sleep", "ms": 1000 }]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { createSandbox, destroySandbox, prepareWorkdir, type Sandbox } from "../bench/sandbox"

const REPO = join(import.meta.dir, "../../..")
/** RAM kept free for the user's other work; OMO_QA_RESERVE_MB overrides it when the user agrees to less. */
const RESERVE_MB = Number(process.env.OMO_QA_RESERVE_MB ?? 3072)
const TUI_COST_MB = 1024

export type Step =
  | { type: "text"; value: string }
  | { type: "key"; value: string }
  | { type: "wait"; for: string; timeoutMs?: number }
  | { type: "capture"; name: string }
  | { type: "sleep"; ms: number }

export type TuiSession = {
  readonly sandbox: Sandbox
  readonly workdir: string
  send(keys: string): void
  type(text: string): void
  capture(): string
  waitFor(pattern: RegExp, timeoutMs?: number): Promise<string>
  openCodeLog(): string
  /** Closes the TUI; the sandbox is deleted unless `keepSandbox` (to restart on the same data, e.g. --continue). */
  stop(options?: { keepSandbox?: boolean }): void
}

function tmux(socket: string, ...args: string[]): string {
  const result = Bun.spawnSync(["tmux", "-L", socket, ...args], { stdout: "pipe", stderr: "pipe" })
  return result.stdout.toString()
}

export function availableMb(): number | undefined {
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(readFileSync("/proc/meminfo", "utf8"))
    return match?.[1] ? Math.round(Number(match[1]) / 1024) : undefined
  } catch {
    return undefined
  }
}

export type StartTuiOptions = {
  plugin: string
  fixture?: string
  name: string
  configure?: (sandbox: Sandbox) => void
  /** Extra `opencode` arguments, e.g. ["--continue"]. */
  args?: readonly string[]
  /** Restart on a sandbox kept by an earlier `stop({ keepSandbox: true })`. */
  reuse?: { sandbox: Sandbox; workdir: string }
}

/** Starts the real TUI for a fixture workdir inside a private tmux server. */
export async function startTui(options: StartTuiOptions): Promise<TuiSession> {
  const sandbox = options.reuse?.sandbox ?? createSandbox(join(tmpdir(), `omo-qa-tui-${process.pid}-${Date.now()}`), options.plugin)
  if (!options.reuse) {
    // The TUI half of the plugin (/omo-models, sidebar) loads from tui.json, next to the server entry.
    const tuiEntry = join(dirname(options.plugin), "tui.js")
    if (existsSync(tuiEntry)) writeFileSync(join(sandbox.root, "config/opencode/tui.json"), JSON.stringify({ plugin: [`file://${tuiEntry}`] }, null, 2))
    options.configure?.(sandbox)
  }
  const workdir = options.reuse?.workdir ?? (options.fixture ? prepareWorkdir(sandbox, options.fixture, options.name) : join(sandbox.root, "work"))
  const socket = `omo-qa-${process.pid}`
  const env = Object.entries(sandbox.env).map(([key, value]) => `${key}=${value}`)
  tmux(socket, "new-session", "-d", "-s", "qa", "-x", "200", "-y", "55", "-c", workdir, "env", ...env, "TERM=xterm-256color", "opencode", ...(options.args ?? []))
  const session: TuiSession = {
    sandbox,
    workdir,
    send: (keys) => void tmux(socket, "send-keys", "-t", "qa", keys),
    type: (text) => void tmux(socket, "send-keys", "-t", "qa", "-l", text),
    capture: () => tmux(socket, "capture-pane", "-p", "-t", "qa"),
    waitFor: async (pattern, timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const screen = session.capture()
        if (pattern.test(screen)) return screen
        await Bun.sleep(500)
      }
      throw new Error(`screen never showed ${pattern} within ${timeoutMs / 1000}s:\n${session.capture()}`)
    },
    openCodeLog: () => {
      const dir = join(sandbox.root, "data/opencode/log")
      if (!existsSync(dir)) return ""
      const latest = readdirSync(dir).filter((name) => name.endsWith(".log")).sort().at(-1)
      return latest ? readFileSync(join(dir, latest), "utf8") : ""
    },
    stop: (stopOptions) => {
      tmux(socket, "kill-server")
      if (!stopOptions?.keepSandbox) destroySandbox(sandbox)
    },
  }
  return session
}

/** The model OpenCode really used for each main-agent request, from its own log. */
export function modelsFromLog(log: string): Array<{ at: string; model: string; agent: string }> {
  const out: Array<{ at: string; model: string; agent: string }> = []
  for (const line of log.split("\n")) {
    if (!line.includes("message=stream ") || line.includes("small=true")) continue
    const at = /timestamp=(\S+)/.exec(line)?.[1] ?? ""
    const model = /modelID=(\S+)/.exec(line)?.[1] ?? ""
    // OpenCode writes agent="Sisyphus - ultraworker" when the name has spaces, agent=build otherwise.
    const agent = /agent="([^"]+)"/.exec(line)?.[1] ?? /agent=(\S+)/.exec(line)?.[1] ?? ""
    out.push({ at, model, agent })
  }
  return out
}

export type UserMessageModel = { readonly messageID: string; readonly model: string; readonly agent: string; readonly error?: string }

/**
 * The model OpenCode really used for each user message: `message=process … messageID=X` is followed by the stream
 * line of that turn. Retries of an earlier turn stream again without a new process line, so they are never
 * mistaken for the answer to a later message. A stream error on that turn is kept (Zen being down is not a model
 * choice).
 */
export function modelsByUserMessage(log: string): UserMessageModel[] {
  const out: UserMessageModel[] = []
  let pending: string | undefined
  for (const line of log.split("\n")) {
    const processed = /message=process .*messageID=(\S+)/.exec(line)?.[1]
    if (processed) {
      pending = processed
      continue
    }
    if (!pending || line.includes("small=true")) continue
    const isStream = line.includes("message=stream ")
    const isError = line.includes('message="stream error"')
    if (!isStream && !isError) continue
    const model = /modelID=(\S+)/.exec(line)?.[1] ?? ""
    const agent = /agent="([^"]+)"/.exec(line)?.[1] ?? /agent=(\S+)/.exec(line)?.[1] ?? ""
    const error = isError ? /error\.error="([^"]*)"/.exec(line)?.[1] ?? "stream error" : undefined
    out.push({ messageID: pending, model, agent, ...(error ? { error } : {}) })
    pending = undefined
  }
  return out
}

async function runSteps(session: TuiSession, steps: Step[], evidence: string): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if (step.type === "text") session.type(step.value)
    if (step.type === "key") session.send(step.value)
    if (step.type === "sleep") await Bun.sleep(step.ms)
    if (step.type === "wait") await session.waitFor(new RegExp(step.for), step.timeoutMs)
    if (step.type === "capture") writeFileSync(join(evidence, `${String(index).padStart(2, "0")}-${step.name}.txt`), session.capture())
  }
}

async function main(): Promise<void> {
  const option = (name: string) => {
    const index = process.argv.indexOf(`--${name}`)
    return index === -1 ? undefined : process.argv[index + 1]
  }
  const free = availableMb()
  if (free !== undefined && free - TUI_COST_MB < RESERVE_MB) {
    console.log(`not starting: ${free} MB available; the TUI needs ~${TUI_COST_MB} MB and ${RESERVE_MB} MB stay free for other work`)
    process.exit(2)
  }
  const plugin = option("plugin") ?? join(REPO, "dist/index.js")
  const steps = JSON.parse(readFileSync(option("steps") ?? "", "utf8")) as Step[]
  const evidence = join(REPO, option("evidence") ?? ".omo/evidence/tui", String(Date.now()))
  mkdirSync(evidence, { recursive: true })
  const session = await startTui({ plugin, name: "tui", fixture: option("fixture") })
  try {
    await session.waitFor(/ctrl\+p|commands|Ask anything|>/i, 180_000)
    await runSteps(session, steps, evidence)
  } finally {
    writeFileSync(join(evidence, "final-screen.txt"), session.capture())
    writeFileSync(join(evidence, "models-used.json"), JSON.stringify(modelsFromLog(session.openCodeLog()), null, 2))
    writeFileSync(join(evidence, "opencode.log"), session.openCodeLog())
    session.stop()
    console.log(`evidence: ${evidence}`)
  }
}

if (import.meta.main) await main()
