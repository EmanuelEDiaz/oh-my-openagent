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
  /** Every tool in the request, heaviest first, with where it comes from. */
  readonly tools: ReadonlyArray<ToolWeight>
  /** Tool weight per source (builtin, plugin, mcp:<server>, ctx), heaviest first. */
  readonly toolSources: ReadonlyArray<SourceWeight>
}

export type ToolWeight = { readonly name: string; readonly tokens: number; readonly source: string }
export type SourceWeight = { readonly source: string; readonly count: number; readonly tokens: number }

/** OpenCode's own tool names (the plugin overrides some of them, e.g. task and skill; they still count as builtin). */
const BUILTIN_TOOLS = new Set([
  "bash", "read", "write", "edit", "multiedit", "apply_patch", "patch", "glob", "grep", "list", "lsp", "task", "skill",
  "webfetch", "websearch", "codesearch", "todowrite", "todoread", "question", "batch", "invalid", "plan_enter", "plan_exit",
])

/** MCP servers seen in OmO sessions; more come from CONTEXT_PROXY_MCP (comma-separated server names). */
export const DEFAULT_MCP_SERVERS = ["chrome-devtools", "supabase", "pencil", "context7", "grep_app", "websearch", "playwright", "github"]

/** Where a tool comes from, judged by its name: OpenCode names MCP tools `<server>_<tool>`. */
export function toolSource(name: string, mcpServers: readonly string[] = DEFAULT_MCP_SERVERS): string {
  if (name.startsWith("ctx_")) return "ctx"
  if (BUILTIN_TOOLS.has(name)) return "builtin"
  const server = [...mcpServers].sort((a, b) => b.length - a.length).find((prefix) => name.startsWith(`${prefix}_`))
  return server ? `mcp:${server}` : "plugin"
}

export function groupBySource(tools: readonly ToolWeight[]): SourceWeight[] {
  const groups = new Map<string, { count: number; tokens: number }>()
  for (const tool of tools) {
    const group = groups.get(tool.source) ?? { count: 0, tokens: 0 }
    groups.set(tool.source, { count: group.count + 1, tokens: group.tokens + tool.tokens })
  }
  return [...groups.entries()].map(([source, group]) => ({ source, ...group })).sort((a, b) => b.tokens - a.tokens)
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

/**
 * Splits a system prompt at line-leading tags (<omo-…>, <Role>, <TOOL_USAGE>), `# ` and `## ` headings and
 * "Instructions from:" markers, and keeps the heaviest sections.
 */
export function systemSections(system: string, keep = 20): Array<{ title: string; tokens: number }> {
  return system
    .split(/\n(?=<[A-Za-z][\w-]*>|#{1,2} |Instructions from: )/)
    .map((part) => ({ title: part.trim().split("\n")[0]?.slice(0, 100) ?? "", tokens: approxTokens(part) }))
    .filter((section) => section.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, keep)
}

export function analyseRequest(raw: string, session?: string, subagent?: boolean, mcpServers: readonly string[] = DEFAULT_MCP_SERVERS): ContextRecord {
  const body = JSON.parse(raw) as ChatBody
  const messages = [...(body.messages ?? []), ...(Array.isArray(body.input) ? body.input.map((item) => ({ role: item.role ?? "user", content: item.content })) : [])]
  const system = [
    ...(body.system !== undefined ? [text(body.system)] : []),
    ...(body.instructions !== undefined ? [text(body.instructions)] : []),
    ...messages.filter((message) => message.role === "system" || message.role === "developer").map((message) => text(message.content)),
  ].join("\n")
  const history = messages.filter((message) => message.role !== "system" && message.role !== "developer").map((message) => text(message.content)).join("\n") + (typeof body.input === "string" ? body.input : "")
  const tools = body.tools ?? []
  const weights = tools
    .map((tool) => {
      const name = tool.function?.name ?? tool.name ?? "?"
      return { name, tokens: approxTokens(JSON.stringify(tool)), source: toolSource(name, mcpServers) }
    })
    .sort((a, b) => b.tokens - a.tokens)
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
    tools: weights,
    toolSources: groupBySource(weights),
  }
}

/** Starts the proxy; requests to http://127.0.0.1:<port>/<path> go to `${upstream}/<path>` unchanged. */
export function startContextProxy(upstream: string, logFile: string): { readonly url: string; stop(): void } {
  const base = upstream.replace(/\/$/, "")
  const mcpServers = [...DEFAULT_MCP_SERVERS, ...(process.env.CONTEXT_PROXY_MCP ?? "").split(",").map((name) => name.trim()).filter(Boolean)]
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.text()
      if (body && /\/(?:chat\/completions|messages|responses)$/.test(url.pathname)) {
        try {
          appendFileSync(logFile, `${JSON.stringify(analyseRequest(body, request.headers.get("x-opencode-session") ?? undefined, request.headers.has("x-parent-session-id") || request.headers.has("x-opencode-parent-session-id"), mcpServers))}\n`)
        } catch {
          // recording must never break the run
        }
      }
      const headers = new Headers(request.headers)
      headers.delete("host")
      headers.delete("content-length")
      try {
        return await fetch(`${base}${url.pathname.replace(/^\/proxy/, "")}${url.search}`, { method: request.method, headers, ...(body === undefined ? {} : { body }) })
      } catch (error) {
        // A dropped upstream connection becomes a retryable 502 for OpenCode instead of an unhandled error.
        return new Response(JSON.stringify({ error: { message: `upstream unreachable: ${error instanceof Error ? error.message : String(error)}` } }), { status: 502, headers: { "content-type": "application/json" } })
      }
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
  /** Mean tool weight per source over the task's requests. */
  readonly toolSources: ReadonlyArray<SourceWeight>
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
    const sources = new Map<string, { count: number[]; tokens: number[] }>()
    for (const record of list) {
      for (const source of record.toolSources ?? []) {
        const entry = sources.get(source.source) ?? { count: [], tokens: [] }
        sources.set(source.source, { count: [...entry.count, source.count], tokens: [...entry.tokens, source.tokens] })
      }
    }
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
      // Averaged over every request of the task (a source absent from a request counts as 0 there).
      toolSources: [...sources.entries()]
        .map(([source, entry]) => ({ source, count: Math.round(entry.count.reduce((a, b) => a + b, 0) / list.length), tokens: Math.round(entry.tokens.reduce((a, b) => a + b, 0) / list.length) }))
        .sort((a, b) => b.tokens - a.tokens),
    }
  })
}

export function renderContextTable(rows: readonly TaskContext[]): string {
  const lines = ["| Task | Requests | Mean tokens/request | Max | System | Tools (count) | Tools by source | History | Heaviest system sections |", "|---|---|---|---|---|---|---|---|---|"]
  for (const row of rows) {
    lines.push(`| ${row.taskId} | ${row.requests} | ${row.meanTotal} | ${row.maxTotal} | ${row.meanSystem} | ${row.meanTools} (${row.meanToolCount}) | ${(row.toolSources ?? []).map((source) => `${source.source} ${source.tokens} (${source.count})`).join("; ")} | ${row.meanHistory} | ${row.topSections.map((section) => `${section.title.replace(/\|/g, "/").slice(0, 40)} ${section.tokens}`).join("; ")} |`)
  }
  return lines.join("\n")
}
