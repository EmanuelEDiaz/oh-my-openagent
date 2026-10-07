import { z } from "zod"

/** Per-request context budget (incidents of 07-10-2026, docs/fork/plans/real-use-incidents.md B.3). */
export const ContextBudgetConfigSchema = z.object({
  /**
   * Hide from the tab orchestrators (Sisyphus, Atlas, Prometheus, Hephaestus) the tools they delegate instead of using:
   * code-navigation LSP tools, ast_grep_*, monitor_*, session_list/read/info and look_at (default: true).
   * Set to false to measure the difference.
   */
  orchestrator_minimal_tools: z.boolean().optional(),
})

export type ContextBudgetConfig = z.infer<typeof ContextBudgetConfigSchema>
