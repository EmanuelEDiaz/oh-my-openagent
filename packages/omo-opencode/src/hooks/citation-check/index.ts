import { checkCitations, scanCitations } from "../../features/knowledge/citation-scan"
import { opencodeDbPath } from "../../features/knowledge/service"
import { openSessionReader } from "../../features/knowledge/session-reader"

const REPORTING_TOOLS = new Set(["task", "call_omo_agent", "background_output"])
const MAX_LISTED = 8

/**
 * Subagent reports are claims: every file:line, commit and chat citation in them is checked, and the
 * invalid ones are appended so the orchestrator does not build on invented references.
 */
export function createCitationCheckHook(ctx: { readonly directory: string }) {
  return {
    "tool.execute.after": async (input: { tool: string }, output: { output: string }): Promise<void> => {
      if (!REPORTING_TOOLS.has(input.tool.toLowerCase()) || typeof output.output !== "string") return
      const citations = scanCitations(output.output)
      if (citations.length === 0) return
      const reader = citations.some((citation) => citation.type === "session") ? await openSessionReader(opencodeDbPath()) : null
      try {
        const invalid = checkCitations(citations, { projectDir: ctx.directory, sessionReader: reader }).filter((check) => !check.ok)
        if (invalid.length === 0) return
        const listed = invalid.slice(0, MAX_LISTED).map((check) => `- ${check.ref}: ${check.reason}`)
        const more = invalid.length > MAX_LISTED ? [`- …and ${invalid.length - MAX_LISTED} more`] : []
        output.output += `\n\n[citation check] ${invalid.length} of ${citations.length} citations in this report could not be verified — do not rely on them without checking:\n${[...listed, ...more].join("\n")}`
      } finally {
        reader?.close()
      }
    },
  }
}
