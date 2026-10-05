/** web-researcher's tools (fork roadmap 4.18); only that agent is allowed to call them. */
import { tool, type ToolDefinition } from "@opencode-ai/plugin"

import type { WebResearch } from "../../features/web-research/research"

export const WEB_RESEARCH_TOOLS = ["web_search", "web_read", "registry_lookup", "web_answer"] as const

function sessionOf(context: unknown): string {
  return (context as { sessionID: string }).sessionID
}

export function createWebResearchTools(research: WebResearch): Record<string, ToolDefinition> {
  return {
    web_search: tool({
      description: "Search the open web. Free sources are asked in parallel and merged; results come numbered [r1], [r2]… Start with short, broad queries, then narrow.",
      args: {
        query: tool.schema.string().describe("Short query; for an error, the exact error message"),
        source: tool.schema.enum(["auto", "stackexchange", "github", "exa", "wikipedia", "hackernews", "mdn", "searxng", "tavily"]).optional().describe("Leave as auto unless one source is clearly best"),
      },
      async execute(args, context) {
        return research.search(sessionOf(context), args.query, args.source ?? "auto")
      },
    }),
    web_read: tool({
      description: "Read one of your search results (use its id, e.g. r2). Returns the passages most relevant to your question, with ids like r2.p1 to quote.",
      args: { ref: tool.schema.string().describe("Result id such as r2 (or its exact URL)") },
      async execute(args, context) {
        return research.read(sessionOf(context), args.ref)
      },
    }),
    registry_lookup: tool({
      description: "Exact current facts, no guessing: latest version, release date and OSV advisories of an npm or PyPI package; the newest Node.js LTS and release (ecosystem node); the latest release of a GitHub repository (ecosystem github, package = owner/repo).",
      args: {
        ecosystem: tool.schema.enum(["npm", "PyPI", "node", "github"]),
        package: tool.schema.string().describe("Package name, owner/repo for github, anything for node"),
      },
      async execute(args, context) {
        return research.registry(sessionOf(context), args.ecosystem, args.package)
      },
    }),
    web_answer: tool({
      description: "Submit your final answer. Every claim needs a URL from your results and a verbatim quote from what you read. Checked in code; one repair attempt.",
      args: {
        answer: tool.schema.string().describe("The direct answer, 1-3 sentences"),
        confidence: tool.schema.enum(["high", "medium", "low", "not_found"]),
        claims: tool.schema.array(tool.schema.object({
          text: tool.schema.string(),
          url: tool.schema.string(),
          quote: tool.schema.string().describe("Verbatim text (≤300 chars) from the page or result"),
        })).describe("Empty only when confidence is not_found"),
        conflicts: tool.schema.array(tool.schema.string()).optional().describe("Where sources disagree"),
        gaps: tool.schema.array(tool.schema.string()).optional().describe("What you could not establish"),
      },
      async execute(args, context) {
        return research.answer(sessionOf(context), args)
      },
    }),
  }
}
