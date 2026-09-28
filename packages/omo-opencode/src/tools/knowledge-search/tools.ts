import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { formatHits } from "../../features/knowledge/format"
import type { KnowledgeService } from "../../features/knowledge/service"
import type { KnowledgeKind } from "../../features/knowledge/types"

const KINDS = ["decision", "adr", "plan", "agents_md", "notepad", "changelog", "doc", "commit", "user", "assistant", "summary", "subagent", "tool"] as const

export const KNOWLEDGE_SEARCH_DESCRIPTION = `Search this project's indexed knowledge: decisions (docs/decisions, ADRs), plans (plans/, .omo/plans), notepads, AGENTS.md rules, CHANGELOG, recent git commits and past session conversations.
Use it BEFORE answering "why was X done this way", "what did we decide about Y", "where did we discuss Z", or before re-deciding something that may already be decided. Results are ranked (BM25) and each has a citable locator: path:line, commit:<sha>, or ses_…/msg_…/prt_…
Not a code search: use grep/glob/lsp for source code.`

export const KNOWLEDGE_OPEN_DESCRIPTION = `Open the ORIGINAL conversation behind a chat citation (ses_…/msg_…/prt_… from knowledge_search or a plan/decision): the cited message verbatim (with its reasoning), the surrounding messages, and the tool calls made (outputs omitted). Read-only.
Use it when a snippet or a compaction summary is not enough to be sure what was actually said or decided — verify instead of recalling.`

export function createKnowledgeOpenTool(service: KnowledgeService): ToolDefinition {
  return tool({
    description: KNOWLEDGE_OPEN_DESCRIPTION,
    args: {
      locator: tool.schema.string().describe("ses_…/msg_…/prt_… (or just ses_… / ses_…/msg_…)"),
      around: tool.schema.number().int().min(0).max(10).optional().describe("Messages to show before and after (default 2)"),
    },
    execute: async (args: { locator: string; around?: number }) => service.open(args.locator, args.around ?? 2),
  })
}

export function createKnowledgeSearchTool(service: KnowledgeService): ToolDefinition {
  return tool({
    description: KNOWLEDGE_SEARCH_DESCRIPTION,
    args: {
      query: tool.schema.string().describe("Words to search for, e.g. \"why redis cache\" or \"worktree cleanup decision\""),
      kinds: tool.schema.array(tool.schema.enum(KINDS)).optional().describe("Only these document kinds"),
      limit: tool.schema.number().int().min(1).max(20).optional().describe("Max results (default 8)"),
      scope: tool.schema.enum(["project", "all"]).optional().describe("Sessions of this project only (default) or of all projects"),
    },
    execute: async (args: { query: string; kinds?: KnowledgeKind[]; limit?: number; scope?: "project" | "all" }) => {
      const hits = await service.search(args.query, {
        ...(args.kinds === undefined ? {} : { kinds: args.kinds }),
        limit: args.limit ?? 8,
        scope: args.scope ?? "project",
      })
      if (hits === null) return "Knowledge index is unavailable in this runtime (SQLite not available)."
      return formatHits(args.query, hits)
    },
  })
}
