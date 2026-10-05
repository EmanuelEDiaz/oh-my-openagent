/** Real OpenCode wiring for broken tool names (fork roadmap 0.15 F). */
import type { OhMyOpenCodeConfig } from "../../config"
import { dispatchInternalPrompt } from "../../hooks/shared/prompt-async-gate"
import { createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { parseModel, resolveSessionTarget } from "../../shared/session-target"
import type { PluginContext } from "../../plugin/types"
import { subagentSessions } from "../claude-code-session-state"
import { createToolNameRepair, type SessionMessage, type ToolNameRepair } from "./hook"

/** On unless `resilience.enabled` or `resilience.repair_tool_names` is false. */
export function createPluginToolNameRepair(ctx: PluginContext, pluginConfig: OhMyOpenCodeConfig): ToolNameRepair | null {
  const config = pluginConfig.resilience
  if (config?.enabled === false || config?.repair_tool_names === false) return null
  const client = ctx.client as unknown as { session: { messages(input: { path: { id: string } }): Promise<unknown> } }

  return createToolNameRepair({
    fetchMessages: async (sessionID) => normalizeSDKResponse<SessionMessage[]>(await client.session.messages({ path: { id: sessionID } }), []),
    continueSession: async (sessionID, text) => {
      // Same agent and the model the session was using.
      const target = await resolveSessionTarget(client, sessionID).catch(() => ({} as { agent?: string; model?: string }))
      const parsed = target.model ? parseModel(target.model) : undefined
      const result = await dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: "tool-name-repair",
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            ...(target.agent ? { agent: target.agent } : {}),
            ...(parsed ? { model: { providerID: parsed.providerID, modelID: parsed.modelID } } : {}),
            ...(parsed?.variant ? { variant: parsed.variant } : {}),
            parts: [createInternalAgentContinuationTextPart(text)],
          },
          query: { directory: ctx.directory },
        },
      })
      log("[tool-name-repair] continuation dispatched", { sessionID, status: result.status })
    },
    isSubagentSession: (sessionID) => subagentSessions.has(sessionID),
    log,
  })
}
