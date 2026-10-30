import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { brokenModelKey } from "./broken-models-cache"
import { getOmoOpenCodeCacheDir } from "./data-path"
import { log } from "./logger"
import { writeFileAtomically } from "./write-file-atomically"

/**
 * Every model each agent had as its omo.jsonc primary, across OpenCode runs (fork plan real-use-incidents A1). A
 * resumed session makes the TUI send that session's last model; when it is one of these, the user never picked it
 * by hand, it was the configured primary back then, so the live /omo-models switch may move it to today's primary.
 */
const HISTORY_FILE = "agent-primary-history.json"
/** Enough to cover months of /omo-models changes without the file growing forever. */
const MAX_PER_AGENT = 20

type HistoryFile = { readonly agents: Readonly<Record<string, readonly string[]>> }

export type AgentPrimaryHistoryOptions = { readonly cacheDir?: string }

function historyPath(options: AgentPrimaryHistoryOptions): string {
  return join(options.cacheDir ?? getOmoOpenCodeCacheDir(), HISTORY_FILE)
}

function readHistory(options: AgentPrimaryHistoryOptions): Record<string, readonly string[]> {
  const path = historyPath(options)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<HistoryFile>
    return parsed.agents && typeof parsed.agents === "object" ? { ...parsed.agents } : {}
  } catch (error) {
    log("[agent-primary-history] history unreadable, ignoring it", { path, error: String(error) })
    return {}
  }
}

export function pastAgentPrimaries(agent: string, options: AgentPrimaryHistoryOptions = {}): string[] {
  const models = readHistory(options)[agent]
  return Array.isArray(models) ? models.filter((model): model is string => typeof model === "string") : []
}

export function recordAgentPrimary(agent: string, model: string, options: AgentPrimaryHistoryOptions = {}): void {
  const key = brokenModelKey(model)
  if (!key) return
  const history = readHistory(options)
  // Recorded on every startup: skip the write when nothing changed.
  if (history[agent]?.at(-1) === key) return
  history[agent] = [...(history[agent] ?? []).filter((entry) => entry !== key), key].slice(-MAX_PER_AGENT)
  const path = historyPath(options)
  try {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileAtomically(path, `${JSON.stringify({ agents: history }, null, 2)}\n`)
  } catch (error) {
    log("[agent-primary-history] cannot save history", { path, error: String(error) })
  }
}
