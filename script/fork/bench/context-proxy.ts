/**
 * Context recorder (fork roadmap 0.13): a local proxy between OpenCode and a provider that forwards every request
 * unchanged and records how much each part of it weighs (agent prompt, loaded rules, plugin guidance, tool
 * definitions, conversation). Every bench report gets a per-agent, per-task context table from it.
 */
import { appendFileSync } from "node:fs"

export type ContextRecord = {
  readonly at: number
  readonly session?: string
  /** True for a subagent's request (OpenCode sends its parent session id). */
  readonly subagent?: boolean
  readonly model?: string
  readonly totalTokens: number
  readonly systemTokens: number
  readonly toolsTokens: number
  readonly toolCount: number
  readonly historyTokens: number
  /** Heaviest system-prompt sections: first line of the section and its approximate tokens. */
  readonly sections: ReadonlyArray<{ readonly title: string; readonly tokens: number }>
  /** Heaviest tools by schema size. */
  readonly heaviestTools: ReadonlyArray<{ readonly name: string; readonly tokens: number }>
}

/** ~4 characters per token: the same rough rule for every part, good enough to compare parts and runs. */
export function approxTokens(text: string): number {
  return Math.round(text.length / 4)
}

/** OpenAI chat, Anthropic messages and OpenAI responses bodies all carry a system prompt, history and tools. */
type ChatBody = {
  model?: string
  system?: unknown
  instructions?: unknown
  messages?: Array<{ role: string; content?: unknown }>
  input?: Array<{ role?: string; content?: unknown }> | string
  tools?: Array<{ name?: string; function?: { name?: string } }>
}

function text(content: unknown): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) return content.map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : JSON.stringify(part))).join("\n")
  return JSON.stringify(content ?? "")
}

/** Splits a system prompt at top-level tags and markdown headings and keeps the heaviest sections. */
export function systemSections(system: string, keep = 12): Array<{ title: string; tokens: number }> {
  return system
    .split(/\n(?=<[a-z][\w-]*>|# |## Instructions from|Instructions from: )/)
    .map((part) => ({ title: part.trim().split("\n")[0]?.slice(0, 100) ?? "", tokens: approxTokens(part) }))
    .filter((section) => section.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, keep)
}

export function analyseRequest(raw: string, session?: string, subagent?: boolean): ContextRecord {
  const body = JSON.parse(raw) as ChatBody
  const messages = [...(body.messages ?? []), ...(Array.isArray(body.input) ? body.input.map((item) => ({ role: item.role ?? "user", content: item.content })) : [])]
  const system = [
    ...(body.system !== undefined ? [text(body.system)] : []),
    ...(body.instructions !== undefined ? [text(body.instructions)] : []),
    ...messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => text(message.content)),
  ].join("\n")
  const history = messages.filter((message) => message.role !== "system" && message.role !== "developer").map((message) => text(message.content)).join("\n") + (typeof body.input === "string" ? body.input : "")
  const tools = body.tools ?? []
  return {
    at: Date.now(),
    ...(session ? { session } : {}),
    ...(subagent ? { subagent: true } : {}),
    ...(body.model ? { model: body.model } : {}),
    totalTokens: approxTokens(raw),
    systemTokens: approxTokens(system),
    toolsTokens: approxTokens(JSON.stringify(tools)),
    toolCount: tools.length,
    historyTokens: approxTokens(history),
    sections: systemSections(system),
    heaviestTools: tools
      .map((tool) => ({ name: tool.function?.name ?? tool.name ?? "?", tokens: approxTokens(JSON.stringify(tool)) }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 8),
  }
}

/** Starts the proxy; requests to http://127.0.0.1:<port>/<path> go to `${upstream}/<path>` unchanged. */
export function startContextProxy(upstream: string, logFile: string): { readonly url: string; stop(): void } {
  const base = upstream.replace(/\/$/, "")
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
      if (body && /\/(?:chat\/completions|messages|responses)$/.test(url.pathname)) {
        try {
          appendFileSync(logFile, `${JSON.stringify(analyseRequest(body, request.headers.get("x-opencode-session") ?? undefined, request.headers.has("x-parent-session-id") || request.headers.has("x-opencode-parent-session-id")))}\n`)
        } catch {
          // recording must never break the run
        }
      }
      const headers = new Headers(request.headers)
      headers.delete("host")
      headers.delete("content-length")
      return fetch(`${base}${url.pathname.replace(/^\/proxy/, "")}${url.search}`, { method: request.method, headers, ...(body === undefined ? {} : { body }) })
    },
  })
  return { url: `http://127.0.0.1:${server.port}/proxy`, stop: () => server.stop(true) }
}

export type ContextWindow = { readonly taskId: string; readonly repeat: number; readonly start: number; readonly end: number }

export type TaskContext = {
  readonly taskId: string
  readonly requests: number
  readonly meanTotal: number
  readonly maxTotal: number
  readonly meanSystem: number
  readonly meanTools: number
  readonly meanHistory: number
  readonly meanToolCount: number
  readonly topSections: ReadonlyArray<{ readonly title: string; readonly tokens: number }>
}

/** Groups recorded requests by the time window each task ran in (tasks run one at a time). */
export function summarizeContext(records: readonly ContextRecord[], windows: readonly ContextWindow[]): TaskContext[] {
  const byTask = new Map<string, ContextRecord[]>()
  for (const window of windows) {
    const inside = records.filter((record) => record.at >= window.start && record.at <= window.end)
    // A task delegated to a subagent: its requests and the orchestrator's are reported apart.
    const hasSub = inside.some((record) => record.subagent)
    for (const record of inside) {
      const key = hasSub ? `${window.taskId} (${record.subagent ? "subagent" : "orchestrator"})` : window.taskId
      byTask.set(key, [...(byTask.get(key) ?? []), record])
    }
  }
  const mean = (values: number[]) => (values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length))
  return [...byTask.entries()].map(([taskId, list]) => {
    const sections = new Map<string, number[]>()
    for (const record of list) for (const section of record.sections) sections.set(section.title, [...(sections.get(section.title) ?? []), section.tokens])
    return {
      taskId,
      requests: list.length,
      meanTotal: mean(list.map((r) => r.totalTokens)),
      maxTotal: Math.max(0, ...list.map((r) => r.totalTokens)),
      meanSystem: mean(list.map((r) => r.systemTokens)),
      meanTools: mean(list.map((r) => r.toolsTokens)),
      meanHistory: mean(list.map((r) => r.historyTokens)),
      meanToolCount: mean(list.map((r) => r.toolCount)),
      topSections: [...sections.entries()].map(([title, tokens]) => ({ title, tokens: mean(tokens) })).sort((a, b) => b.tokens - a.tokens).slice(0, 5),
    }
  })
}

export function renderContextTable(rows: readonly TaskContext[]): string {
  const lines = ["| Task | Requests | Mean tokens/request | Max | System | Tools (count) | History | Heaviest system sections |", "|---|---|---|---|---|---|---|---|"]
  for (const row of rows) {
    lines.push(`| ${row.taskId} | ${row.requests} | ${row.meanTotal} | ${row.maxTotal} | ${row.meanSystem} | ${row.meanTools} (${row.meanToolCount}) | ${row.meanHistory} | ${row.topSections.map((section) => `${section.title.replace(/\|/g, "/").slice(0, 40)} ${section.tokens}`).join("; ")} |`)
  }
  return lines.join("\n")
}
