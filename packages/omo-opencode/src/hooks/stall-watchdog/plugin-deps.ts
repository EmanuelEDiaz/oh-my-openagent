/** Real OpenCode wiring for the stall watchdog hook (fork roadmap 0.8a). */
import { isNetworkError } from "@oh-my-opencode/model-core"

import type { OhMyOpenCodeConfig } from "../../config"
import { abortWithTimeout } from "../../features/background-agent/abort-with-timeout"
import { getActiveProcessManager } from "../../features/managed-process"
import { getActiveResumeService } from "../../features/resume/plugin"
import { getActiveLoopBreaker } from "../../features/loop-breaker/plugin"
import { getNetworkGuard, isNetworkResilienceEnabled } from "../../features/network-guard"
import { subagentSessions, syncSubagentSessions } from "../../features/claude-code-session-state"
import { createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { parseModel, resolveSessionTarget } from "../../shared/session-target"
import { getFallbackModelsForSession } from "../runtime-fallback/fallback-models"
import { dispatchInternalPrompt } from "../shared/prompt-async-gate"
import type { PluginContext } from "../../plugin/types"
import { createStallWatchdogHook, type StallWatchdogHookDeps } from "./hook"

type SessionGetClient = { session: { get(input: { path: { id: string } }): Promise<{ data?: unknown }> } }

/** Whether a session has a parent, asked once per session: a parent never changes. A failed lookup is not cached. */
export function createParentLookup(client: SessionGetClient): (sessionID: string) => Promise<boolean> {
  const known = new Map<string, boolean>()
  return async (sessionID) => {
    const cached = known.get(sessionID)
    if (cached !== undefined) return cached
    const info = await client.session.get({ path: { id: sessionID } })
    const hasParent = Boolean((info.data as { parentID?: string } | undefined)?.parentID)
    known.set(sessionID, hasParent)
    return hasParent
  }
}

export function createPluginStallWatchdogHook(ctx: PluginContext, pluginConfig: OhMyOpenCodeConfig) {
  const stall = pluginConfig.stall
  const deps: StallWatchdogHookDeps = {
    hasManagedProcess: (sessionID) => getActiveProcessManager(ctx.directory)?.isWaiting(sessionID) ?? false,
    isSubagentSession: (sessionID) => subagentSessions.has(sessionID) || syncSubagentSessions.has(sessionID),
    hasParent: createParentLookup(ctx.client as unknown as SessionGetClient),
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
      await getActiveResumeService(ctx.directory)?.pause(sessionID, reason, attempts)
    },
    fallbackModels: (sessionID, agent) => getFallbackModelsForSession(sessionID, agent, pluginConfig),
    chargeBudget: (sessionID) => getActiveLoopBreaker(ctx.directory)?.charge(sessionID, "stall recovery"),
    // Network cuts and freezes (fork roadmap 0.15): read lazily, the guard may be created after this hook.
    isWaiting: (sessionID) => getNetworkGuard(ctx.directory)?.isWaiting(sessionID) ?? false,
    isNetworkRetry: (message) => isNetworkResilienceEnabled() && isNetworkError(message),
    takeOverStall: async (sessionID, opts) => (await getNetworkGuard(ctx.directory)?.takeOverStall(sessionID, opts)) ?? false,
    onFreeze: (sessionIDs, seconds) => getNetworkGuard(ctx.directory)?.afterFreeze(sessionIDs, seconds),
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
      directory: ctx.directory,
      ...(pluginConfig.resilience?.enabled === false ? {} : { freezeThresholdMs: (pluginConfig.resilience?.freeze_threshold_s ?? 10) * 1000 }),
    },
    deps,
  )
}
