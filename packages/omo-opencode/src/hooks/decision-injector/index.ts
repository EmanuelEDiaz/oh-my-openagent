import { statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { decisionPaths } from "../../features/knowledge/decision-files"
import type { DecisionRecord } from "../../features/knowledge/decision-files"
import { decisionsForFile, formatFileDecisions, loadActiveDecisions } from "../../features/knowledge/decision-injection"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { getRuleInjectionFilePath } from "../rules-injector/output-path"

const TRACKED_TOOLS = new Set(["read", "write", "edit", "multiedit"])

type ToolOutput = { title: string; output: string; metadata: unknown }

/**
 * When an agent reads or edits a file that an active decision cites as evidence, the decision is
 * appended to the tool result (once per session; state resets after compaction), so recorded
 * decisions reach the agent without it having to remember to search for them.
 */
export function createDecisionInjectorHook(ctx: { readonly directory: string }, _config?: KnowledgeConfig) {
  const injected = new Map<string, Set<string>>()
  let cached: { key: string; records: DecisionRecord[] } | undefined

  const activeDecisions = (): DecisionRecord[] => {
    const paths = decisionPaths(ctx.directory)
    const key = paths.map((path) => `${path}:${statSync(join(ctx.directory, path)).mtimeMs}`).join("|")
    if (cached?.key !== key) cached = { key, records: loadActiveDecisions(ctx.directory) }
    return cached.records
  }

  const clear = (properties: unknown): void => {
    const sessionID = resolveSessionEventID(properties as Record<string, unknown> | undefined)
    if (sessionID) injected.delete(sessionID)
  }

  return {
    "tool.execute.after": (input: { tool: string; sessionID: string }, output: ToolOutput): void => {
      if (!TRACKED_TOOLS.has(input.tool.toLowerCase()) || typeof output.output !== "string") return
      const filePath = getRuleInjectionFilePath(output)
      if (!filePath) return
      const absolute = isAbsolute(filePath) ? filePath : resolve(ctx.directory, filePath)
      const relativePath = relative(ctx.directory, absolute).split("\\").join("/")
      if (relativePath.startsWith("..") || isAbsolute(relativePath) || relativePath.startsWith("docs/decisions/")) return
      const seen = injected.get(input.sessionID) ?? new Set<string>()
      const fresh = decisionsForFile(ctx.directory, activeDecisions(), relativePath).filter((item) => !seen.has(item.record.id))
      if (fresh.length === 0) return
      for (const item of fresh) seen.add(item.record.id)
      injected.set(input.sessionID, seen)
      output.output += `\n\n${formatFileDecisions(relativePath, fresh)}`
    },
    event: ({ event }: { event: { type: string; properties?: unknown } }): void => {
      if (event.type === "session.compacted" || event.type === "session.deleted") clear(event.properties)
    },
  }
}
