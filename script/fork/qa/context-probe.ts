#!/usr/bin/env bun
/**
 * Context probe at zero model cost: how many tokens a plain "hola" to "Sisyphus - ultraworker" sends to the model with
 * the user's REAL setup (opencode.json plugins/instructions/MCP, global AGENTS.md, ~/.omo/omo.jsonc, skills dirs,
 * global commands), comparing plugin builds. OpenCode Zen is replaced by a local mock that records each request body
 * and answers "¡Hola!"; nothing reaches a real model.
 *
 *   bun script/fork/qa/context-probe.ts --plugin before=/path/a/index.js --plugin after=dist-probe/index.js \
 *     [--out probe.json] [--keep-bodies dir]
 *
 * Each build runs in its own XDG sandbox (deleted at the end, also on failure), one OpenCode at a time, and only after
 * MemAvailable reaches --min-ram-mb (default 4150) so the user keeps 3 GB free.
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { analyseRequest, approxTokens, type ContextRecord } from "../bench/context-proxy"
import { createSandbox, destroySandbox, onStopSignal, overridePluginConfig, saveServerLogs, startServer, warmUp, type Sandbox, type Server } from "../bench/sandbox"

const HOME = homedir()
const REAL_CONFIG = join(process.env.XDG_CONFIG_HOME ?? join(HOME, ".config"), "opencode")
const MODEL = "opencode/big-pickle"
const AGENT = "Sisyphus - ultraworker"
/** MCP servers that cannot run in the sandbox: supabase needs OAuth, pencil's binary lives in a per-launch AppImage mount. */
const DROPPED_MCP = ["supabase", "pencil"]

function options(name: string): string[] {
  const values: string[] = []
  process.argv.forEach((arg, index) => {
    if (arg === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1] as string)
  })
  return values
}
const option = (name: string, fallback?: string) => options(name)[0] ?? fallback

function memAvailableMb(): number {
  const line = readFileSync("/proc/meminfo", "utf8").split("\n").find((entry) => entry.startsWith("MemAvailable:"))
  return Math.floor(Number(line?.split(/\s+/)[1] ?? 0) / 1024)
}

async function waitForRam(minMb: number): Promise<void> {
  let warned = false
  while (memAvailableMb() < minMb) {
    if (!warned) console.log(`waiting for MemAvailable >= ${minMb} MB (now ${memAvailableMb()} MB)`)
    warned = true
    await Bun.sleep(5000)
  }
}

// --- Mock OpenCode Zen: records every model request, answers a minimal OpenAI chat-completions stream ------------
type Recorded = { readonly at: number; readonly path: string; readonly body: string; readonly session?: string; readonly subagent: boolean }

function startMockZen() {
  const recorded: Recorded[] = []
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET") return Response.json({ object: "list", data: [{ id: "big-pickle", object: "model" }] })
      const body = await request.text()
      recorded.push({
        at: Date.now(),
        path: url.pathname,
        body,
        ...(request.headers.get("x-opencode-session") ? { session: request.headers.get("x-opencode-session") as string } : {}),
        subagent: request.headers.has("x-parent-session-id") || request.headers.has("x-opencode-parent-session-id"),
      })
      const parsed = (() => {
        try {
          return JSON.parse(body) as { stream?: boolean; model?: string }
        } catch {
          return {}
        }
      })()
      const model = parsed.model ?? "big-pickle"
      const created = Math.floor(Date.now() / 1000)
      if (parsed.stream === false) {
        return Response.json({ id: "probe", object: "chat.completion", created, model, choices: [{ index: 0, message: { role: "assistant", content: "¡Hola!" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
      }
      const chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`
      const stream =
        chunk({ id: "probe", object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant", content: "¡Hola!" }, finish_reason: null }] }) +
        chunk({ id: "probe", object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) +
        "data: [DONE]\n\n"
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/v1`, recorded, stop: () => server.stop(true) }
}

// --- The user's real setup, copied into the sandbox ---------------------------------------------------------------
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function copyIfExists(from: string, to: string): boolean {
  if (!existsSync(from)) return false
  cpSync(from, to, { recursive: true })
  return true
}

function installRealSetup(sandbox: Sandbox, pluginEntry: string, mockUrl: string): string[] {
  const notes: string[] = []
  const real = readJson(join(REAL_CONFIG, "opencode.json"))
  const plugins = ((real["plugin"] as string[] | undefined) ?? []).map((entry) => (/omo-fork|oh-my-open/.test(entry) ? `file://${resolve(pluginEntry)}` : entry))
  const mcp = { ...((real["mcp"] as Record<string, unknown> | undefined) ?? {}) }
  for (const name of DROPPED_MCP) {
    if (name in mcp) {
      delete mcp[name]
      notes.push(`dropped MCP ${name}`)
    }
  }
  const config = {
    ...real,
    plugin: plugins,
    mcp,
    snapshot: false,
    model: MODEL,
    small_model: MODEL,
    provider: { opencode: { options: { baseURL: mockUrl } } },
  }
  writeFileSync(join(sandbox.root, "config/opencode/opencode.json"), JSON.stringify(config, null, 2))
  // Global rules and commands (OpenCode reads them from its config dir).
  for (const name of ["AGENTS.md", "command", "commands", "agent", "agents", "skill", "skills"]) {
    if (copyIfExists(join(REAL_CONFIG, name), join(sandbox.root, "config/opencode", name))) notes.push(`copied ~/.config/opencode/${name}`)
  }
  // Skills OpenCode and the plugin discover under HOME (Claude Code and the .agents convention), plus Claude's CLAUDE.md.
  for (const name of [".agents/skills", ".claude/skills", ".claude/CLAUDE.md"]) {
    const target = join(sandbox.env.HOME as string, name)
    mkdirSync(join(target, ".."), { recursive: true })
    if (copyIfExists(join(HOME, name), target)) notes.push(`copied ~/${name}`)
  }
  // Every agent and category on the free model: the request still goes to the mock, never to a real provider.
  overridePluginConfig(sandbox, { allModels: MODEL })
  return notes
}

// --- One run ------------------------------------------------------------------------------------------------------
type Status = Record<string, { type?: string }>

async function waitSettled(client: ReturnType<typeof createOpencodeClient>, sessionID: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let idle = 0
  while (idle < 3) {
    if (Date.now() > deadline) throw new Error(`session did not settle within ${timeoutMs / 1000}s`)
    await Bun.sleep(2000)
    const statuses = ((await client.session.status({})).data ?? {}) as Status
    idle = (statuses[sessionID]?.type ?? "idle") === "idle" ? idle + 1 : 0
  }
}

/** Approximate tokens of every <available_skills> block (system prompt or tool descriptions) in a request body. */
function skillsBlockTokens(raw: string): number {
  const decoded = JSON.stringify(JSON.parse(raw)).replace(/\\n/g, "\n").replace(/\\"/g, '"')
  const blocks = decoded.match(/<available_skills>[\s\S]*?<\/available_skills>/g) ?? []
  return blocks.reduce((sum, block) => sum + approxTokens(block), 0)
}

function skillToolTokens(record: ContextRecord): number {
  return record.tools.find((tool) => tool.name === "skill")?.tokens ?? 0
}

function withSkills(record: ContextRecord, raw: string) {
  return { ...record, skillsBlockTokens: skillsBlockTokens(raw), skillToolTokens: skillToolTokens(record) }
}

type RunResult = {
  readonly label: string
  readonly plugin: string
  readonly notes: string[]
  readonly requests: number
  readonly main?: ContextRecord & { readonly skillsBlockTokens: number; readonly skillToolTokens: number }
  readonly second?: ContextRecord
  readonly others: ReadonlyArray<{ path: string; totalTokens: number; toolCount: number; subagent: boolean }>
}

async function runOnce(label: string, pluginEntry: string, minRamMb: number, keepBodies?: string): Promise<RunResult> {
  await waitForRam(minRamMb)
  const root = join(tmpdir(), `omo-context-probe-${label}-${process.pid}-${Date.now()}`)
  const mock = startMockZen()
  let sandbox: Sandbox | undefined
  let server: Server | undefined
  const stopped = onStopSignal(() => {
    server?.stop()
    mock.stop()
    if (sandbox) destroySandbox(sandbox)
  })
  try {
    sandbox = createSandbox(root, pluginEntry)
    const notes = installRealSetup(sandbox, pluginEntry, mock.url)
    server = await startServer(sandbox, 300_000)
    if (!(await warmUp(sandbox, server))) notes.push("warning: provider cache did not appear during warm-up")
    const before = mock.recorded.length
    const workdir = join(sandbox.root, "work", "probe")
    mkdirSync(workdir, { recursive: true })
    Bun.spawnSync(["git", "init", "-q"], { cwd: workdir, env: { ...process.env, ...sandbox.env } })
    const client = createOpencodeClient({ baseUrl: server.baseUrl, directory: workdir })
    const sessionID = ((await client.session.create({ title: "context probe" })).data as { id: string }).id
    await client.session.promptAsync({ sessionID, agent: AGENT, parts: [{ type: "text", text: "hola" }] })
    await waitSettled(client, sessionID, 300_000)
    await Bun.sleep(5000)
    const requests = mock.recorded.slice(before)
    const isMain = (request: Recorded) => {
      try {
        return ((JSON.parse(request.body) as { tools?: unknown[] }).tools?.length ?? 0) > 0 && !request.subagent
      } catch {
        return false
      }
    }
    const mainRequests = requests.filter(isMain)
    if (keepBodies) {
      mkdirSync(keepBodies, { recursive: true })
      requests.forEach((request, index) => writeFileSync(join(keepBodies, `${label}-${index}${isMain(request) ? "-main" : ""}.json`), request.body))
    }
    const first = mainRequests[0]
    const second = mainRequests[1]
    return {
      label,
      plugin: pluginEntry,
      notes,
      requests: requests.length,
      ...(first ? { main: withSkills(analyseRequest(first.body, first.session, first.subagent), first.body) } : {}),
      ...(second ? { second: analyseRequest(second.body, second.session, second.subagent) } : {}),
      others: requests.filter((request) => !isMain(request)).map((request) => {
        const record = analyseRequest(request.body)
        return { path: request.path, totalTokens: record.totalTokens, toolCount: record.toolCount, subagent: request.subagent }
      }),
    }
  } catch (error) {
    // A failed run deletes its sandbox below: keep OpenCode's and the plugin's logs to find out why.
    if (sandbox) {
      const logs = join(process.cwd(), ".omo/evidence/context-probe-failures", `${label}-${Date.now()}`)
      mkdirSync(logs, { recursive: true })
      saveServerLogs(sandbox, logs)
      console.error(`run ${label} failed; logs kept in ${logs}`)
    }
    throw error
  } finally {
    stopped()
    server?.stop()
    mock.stop()
    if (sandbox) destroySandbox(sandbox)
  }
}

function render(results: readonly RunResult[]): string {
  const lines: string[] = []
  const row = (name: string, pick: (result: RunResult) => string) => lines.push(`| ${name} | ${results.map(pick).join(" | ")} |`)
  lines.push(`| Metric | ${results.map((result) => result.label).join(" | ")} |`, `|---|${results.map(() => "---").join("|")}|`)
  row("Total tokens (~4 chars/token)", (r) => String(r.main?.totalTokens ?? "-"))
  row("System tokens", (r) => String(r.main?.systemTokens ?? "-"))
  row("Tools tokens (count)", (r) => (r.main ? `${r.main.toolsTokens} (${r.main.toolCount})` : "-"))
  row("History tokens", (r) => String(r.main?.historyTokens ?? "-"))
  row("Tools by source", (r) => (r.main?.toolSources ?? []).map((source) => `${source.source} ${source.tokens} (${source.count})`).join("; "))
  row("Skills block (<available_skills>)", (r) => String(r.main?.skillsBlockTokens ?? "-"))
  row("skill tool definition", (r) => String(r.main?.skillToolTokens ?? "-"))
  row("Model requests (all)", (r) => String(r.requests))
  row("Second main request total", (r) => String(r.second?.totalTokens ?? "none"))
  lines.push("")
  for (const result of results) {
    lines.push(`### ${result.label} — heaviest system sections`, ...(result.main?.sections ?? []).slice(0, 12).map((section) => `- ${section.tokens} — ${section.title}`))
    lines.push(`Heaviest tools: ${(result.main?.tools ?? []).slice(0, 10).map((tool) => `${tool.name} ${tool.tokens}`).join(", ")}`)
    lines.push(`Other requests: ${result.others.map((other) => `${other.path} ${other.totalTokens} tok/${other.toolCount} tools${other.subagent ? " (subagent)" : ""}`).join("; ") || "none"}`)
    lines.push(`Setup: ${result.notes.join("; ")}`, "")
  }
  return lines.join("\n")
}

async function main(): Promise<void> {
  const plugins = options("plugin").map((entry) => {
    const [label, path] = entry.includes("=") ? (entry.split(/=(.*)/s) as [string, string]) : [entry, entry]
    if (!existsSync(path)) throw new Error(`plugin entry not found: ${path}`)
    return { label, path }
  })
  if (plugins.length === 0) throw new Error("pass at least one --plugin label=path/to/index.js")
  const minRamMb = Number(option("min-ram-mb", "4150"))
  const results: RunResult[] = []
  for (const plugin of plugins) {
    console.log(`running ${plugin.label} (${plugin.path})`)
    results.push(await runOnce(plugin.label, plugin.path, minRamMb, option("keep-bodies")))
  }
  const out = option("out")
  if (out) writeFileSync(out, JSON.stringify(results, null, 2))
  console.log(render(results))
}

await main()
