/** Real OpenCode wiring for the stall watchdog hook (fork roadmap 0.8a). */
import type { OhMyOpenCodeConfig } from "../../config"
import { abortWithTimeout } from "../../features/background-agent/abort-with-timeout"
import { getActiveProcessManager } from "../../features/managed-process"
import { getActiveResumeService } from "../../features/resume/plugin"
import { subagentSessions, syncSubagentSessions } from "../../features/claude-code-session-state"
import { createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { parseModel, resolveSessionTarget } from "../../shared/session-target"
import { getFallbackModelsForSession } from "../runtime-fallback/fallback-models"
import { dispatchInternalPrompt } from "../shared/prompt-async-gate"
import type { PluginContext } from "../../plugin/types"
import { createStallWatchdogHook, type StallWatchdogHookDeps } from "./hook"

export function createPluginStallWatchdogHook(ctx: PluginContext, pluginConfig: OhMyOpenCodeConfig) {
  const stall = pluginConfig.stall
  const deps: StallWatchdogHookDeps = {
    hasManagedProcess: (sessionID) => getActiveProcessManager()?.isWaiting(sessionID) ?? false,
    isSubagentSession: (sessionID) => subagentSessions.has(sessionID) || syncSubagentSessions.has(sessionID),
    abort: async (sessionID) => {
      // Raced against a timeout: aborting a stalled stream can hang inside OpenCode.
      await abortWithTimeout(ctx.client as never, sessionID)
    },
    toast: async (message) => {
      await ctx.client.tui
        .showToast({ body: { title: "Model stalled", message, variant: "warning", duration: 12_000 } })
        .catch(() => undefined)
    },
    resolveTarget: (sessionID) => resolveSessionTarget(ctx.client as never, sessionID),
    pause: async (sessionID, reason, attempts) => {
      await getActiveResumeService()?.pause(sessionID, reason, attempts)
    },
    fallbackModels: (sessionID, agent) => getFallbackModelsForSession(sessionID, agent, pluginConfig),
    continueSession: async (sessionID, input) => {
      const model = input.model ? parseModel(input.model) : undefined
      const result = await dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: "stall-watchdog",
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            ...(input.agent ? { agent: input.agent } : {}),
            ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
            ...(model?.variant ? { variant: model.variant } : {}),
            parts: [createInternalAgentContinuationTextPart(input.text)],
          },
          query: { directory: ctx.directory },
        },
      })
      log("[stall-watchdog] continuation dispatched", { sessionID, status: result.status })
    },
  }
  return createStallWatchdogHook(
    {
      inactivityMs: stall?.inactivity_ms ?? 240_000,
      checkIntervalMs: stall?.check_interval_ms ?? 15_000,
      maxStallsPerTask: stall?.max_stalls_per_task ?? 2,
    },
    deps,
  )
}
