import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { evaluatePlanEdit, formatGateMessage } from "../../features/knowledge/evidence-gate"
import type { EvidenceGateMode } from "../../features/knowledge/evidence-gate"

const GATED_TOOLS = new Set(["write", "edit", "multiedit"])

/**
 * "Done requires evidence": marking a plan checkbox as done without a verifiable citation is rejected
 * (mode block, the default) or annotated (mode warn).
 */
export function createEvidenceGateHook(ctx: { readonly directory: string }, config?: KnowledgeConfig) {
  const mode: EvidenceGateMode = config?.evidence_gate ?? "block"
  const pendingWarnings = new Map<string, string>()

  return {
    "tool.execute.before": (input: { tool: string; callID?: string }, output: { args: Record<string, unknown> }): void => {
      if (mode === "off" || !GATED_TOOLS.has(input.tool.toLowerCase())) return
      const evaluation = evaluatePlanEdit(input.tool.toLowerCase(), output.args, { projectDir: ctx.directory })
      if (!evaluation || evaluation.violations.length === 0) return
      if (mode === "block") throw new Error(formatGateMessage(evaluation, "block"))
      if (input.callID) pendingWarnings.set(input.callID, formatGateMessage(evaluation, "warn"))
    },
    "tool.execute.after": (input: { callID?: string }, output: { output: string }): void => {
      const warning = input.callID ? pendingWarnings.get(input.callID) : undefined
      if (!warning || !input.callID) return
      pendingWarnings.delete(input.callID)
      output.output += `\n\n${warning}`
    },
  }
}
