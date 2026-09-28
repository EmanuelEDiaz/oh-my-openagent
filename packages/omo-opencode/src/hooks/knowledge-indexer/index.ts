import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { getKnowledgeService } from "../../features/knowledge/service"
import type { KnowledgeService } from "../../features/knowledge/service"

const FILE_WRITING_TOOLS = new Set(["write", "edit", "multiedit", "apply_patch"])

/**
 * Keeps the project knowledge index fresh: an initial background sync when the plugin starts, then
 * a debounced sync whenever a session goes idle or a file-writing tool ran.
 */
export function createKnowledgeIndexerHook(
  ctx: { readonly directory: string },
  config: KnowledgeConfig | undefined,
  service: KnowledgeService = getKnowledgeService(ctx.directory, config),
) {
  service.scheduleSync("startup")
  return {
    event: ({ event }: { event: { type: string } }) => {
      if (event.type === "session.idle") service.scheduleSync("session.idle")
    },
    "tool.execute.after": (input: { tool: string }) => {
      if (FILE_WRITING_TOOLS.has(input.tool)) service.scheduleSync(`tool:${input.tool}`)
    },
  }
}
