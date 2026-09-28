import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { loadDecisions } from "../../features/knowledge/decision-files"
import { decisionStatus, recordDecision } from "../../features/knowledge/decisions"
import type { DecisionInput } from "../../features/knowledge/decisions"
import { formatHits } from "../../features/knowledge/format"
import type { KnowledgeService } from "../../features/knowledge/service"
import { opencodeDbPath } from "../../features/knowledge/service"
import { openSessionReader } from "../../features/knowledge/session-reader"

export const DECISION_RECORD_DESCRIPTION = `Record a non-trivial decision (library/approach choice, data model, boundary, trade-off) so a future session knows WHAT was decided and WHY without re-deriving it.
Written to docs/decisions/D-<date>-<n>-<slug>.md (versioned with the project) in the planning-log format: Context · Options considered · Decision · Reason · Reversibility · Evidence · Evidence session (filled automatically). Pass plan_path to also append it to that plan's "## Decisions log".
Every evidence item is verified before anything is written: file lines must exist (path:10-20), commits must exist, chats must exist (ses_…/msg_…/prt_…), URLs must be well-formed. Invented citations are rejected.
Search first (decision_search) so you supersede instead of contradicting an earlier decision.`

export const DECISION_SEARCH_DESCRIPTION = `Search recorded decisions and ADRs (docs/decisions, docs/adr) before making or revisiting a decision. Superseded decisions are hidden unless include_superseded is true. Each hit has a citable path:line.`

type DecisionRecordArgs = {
  title: string
  context: string
  options: string[]
  decision: string
  reason: string
  reversibility: DecisionInput["reversibility"]
  evidence: { type: "file" | "commit" | "url" | "session"; ref: string; note?: string }[]
  supersedes?: string
  plan_path?: string
  area?: string
}

export function createDecisionTools(service: KnowledgeService): Record<string, ToolDefinition> {
  const decision_record = tool({
    description: DECISION_RECORD_DESCRIPTION,
    args: {
      title: tool.schema.string().min(3).describe("Short title, e.g. \"Use Valkey for the cache\""),
      context: tool.schema.string().describe("What forced the decision"),
      options: tool.schema.array(tool.schema.string()).min(1).describe("Options considered, one line each (\"Redis — license risk\")"),
      decision: tool.schema.string().describe("What was chosen"),
      reason: tool.schema.string().describe("Why, 1-3 lines"),
      reversibility: tool.schema.enum(["easy", "costly", "hard"]),
      evidence: tool.schema.array(tool.schema.object({
        type: tool.schema.enum(["file", "commit", "url", "session"]),
        ref: tool.schema.string().describe("path:10-20 | <sha> | https://… | ses_…/msg_…/prt_…"),
        note: tool.schema.string().optional(),
      })).min(1).describe("Verifiable sources backing the decision"),
      supersedes: tool.schema.string().optional().describe("Id of the decision this replaces, e.g. D-20260928-1"),
      plan_path: tool.schema.string().optional().describe("Plan file whose Decisions log should link this decision, e.g. plans/cache.md"),
      area: tool.schema.string().optional().describe("Optional area, e.g. cache, auth, billing"),
    },
    execute: async (args: DecisionRecordArgs, context) => {
      const projectDir = context.worktree || context.directory
      const sessionReader = await openSessionReader(opencodeDbPath())
      try {
        const result = recordDecision({
          title: args.title,
          context: args.context,
          options: args.options,
          decision: args.decision,
          reason: args.reason,
          reversibility: args.reversibility,
          evidence: args.evidence,
          ...(args.supersedes ? { supersedes: args.supersedes } : {}),
          ...(args.plan_path ? { planPath: args.plan_path } : {}),
          ...(args.area ? { area: args.area } : {}),
        }, { sessionId: context.sessionID, messageId: context.messageID, agent: context.agent }, { projectDir, sessionReader })
        if (!result.ok) return `Decision NOT recorded. Fix these and retry:\n- ${result.problems.join("\n- ")}`
        service.scheduleSync("decision_record")
        return [
          `Recorded ${result.id} in ${result.path}${result.planPath ? ` and linked it in the Decisions log of ${result.planPath}` : ""}.`,
          ...result.notes,
          "Commit it with the change it explains.",
        ].join("\n")
      } finally {
        sessionReader?.close()
      }
    },
  })

  const decision_search = tool({
    description: DECISION_SEARCH_DESCRIPTION,
    args: {
      query: tool.schema.string().describe("What the decision is about"),
      include_superseded: tool.schema.boolean().optional(),
      area: tool.schema.string().optional().describe("Only decisions of this area"),
      limit: tool.schema.number().int().min(1).max(20).optional(),
    },
    execute: async (args: { query: string; include_superseded?: boolean; area?: string; limit?: number }, context) => {
      const projectDir = context.worktree || context.directory
      const hits = await service.search(args.query, { kinds: ["decision", "adr"], limit: (args.limit ?? 8) * 2 })
      if (hits === null) return "Knowledge index is unavailable in this runtime."
      const { valid, invalid } = loadDecisions(projectDir)
      const areaByPath = new Map(valid.map((record) => [record.path, record.area]))
      const invalidNote = invalid.length === 0
        ? ""
        : `\n\n${invalid.length} decision record(s) are malformed and may be missing from results: ${invalid.map((record) => `${record.path} (${record.problems.join("; ")})`).join(", ")}`
      const annotated = hits
        .map((hit) => {
          const status = hit.kind === "decision" ? decisionStatus(projectDir, hit.locator.replace(/:\d+$/, "")) : undefined
          return { ...hit, title: status ? `${hit.title} [${status}]` : hit.title, status }
        })
        .filter((hit) => args.include_superseded || hit.status !== "superseded")
        .filter((hit) => !args.area || areaByPath.get(hit.locator.replace(/:\d+$/, "")) === args.area)
        .slice(0, args.limit ?? 8)
      return (annotated.length === 0 ? `No recorded decision matches "${args.query}".` : formatHits(args.query, annotated)) + invalidNote
    },
  })

  return { decision_record, decision_search }
}
