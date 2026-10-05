import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginContext } from "../types"

import {
  createTodoContinuationEnforcer,
  createBackgroundNotificationHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createCompactionTodoPreserverHook,
  createAtlasHook,
} from "../../hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { createLosslessCompactionHook } from "../../hooks/lossless-compaction"
import { createPluginStallWatchdogHook } from "../../hooks/stall-watchdog"
import { createPluginNetworkGuard } from "../../features/network-guard/plugin"
import { createUnstableAgentBabysitter } from "../unstable-agent-babysitter"

export type ContinuationHooks = {
  stopContinuationGuard: ReturnType<typeof createStopContinuationGuardHook> | null
  compactionContextInjector: ReturnType<typeof createCompactionContextInjector> | null
  compactionTodoPreserver: ReturnType<typeof createCompactionTodoPreserverHook> | null
  losslessCompaction: ReturnType<typeof createLosslessCompactionHook> | null
  networkGuard: ReturnType<typeof createPluginNetworkGuard>
  stallWatchdog: ReturnType<typeof createPluginStallWatchdogHook> | null
  todoContinuationEnforcer: ReturnType<typeof createTodoContinuationEnforcer> | null
  unstableAgentBabysitter: ReturnType<typeof createUnstableAgentBabysitter> | null
  backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null
  atlasHook: ReturnType<typeof createAtlasHook> | null
}

export function createContinuationHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  backgroundManager: BackgroundManager
}): ContinuationHooks {
  const {
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
  } = args

  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? safeHook("stop-continuation-guard", () =>
        createStopContinuationGuardHook(ctx, {
          backgroundManager,
        }))
    : null

  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? safeHook("compaction-context-injector", () =>
        createCompactionContextInjector({ ctx, backgroundManager }))
    : null

  const compactionTodoPreserver = isHookEnabled("compaction-todo-preserver")
    ? safeHook("compaction-todo-preserver", () => createCompactionTodoPreserverHook(ctx))
    : null

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? safeHook("todo-continuation-enforcer", () =>
      createTodoContinuationEnforcer(ctx, {
          backgroundManager,
          isContinuationStopped: stopContinuationGuard?.isStopped,
        }))
    : null

  const unstableAgentBabysitter = isHookEnabled("unstable-agent-babysitter")
    ? safeHook("unstable-agent-babysitter", () =>
        createUnstableAgentBabysitter({ ctx, backgroundManager, pluginConfig }))
    : null

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? safeHook("background-notification", () => createBackgroundNotificationHook(backgroundManager))
    : null

  const atlasHook = isHookEnabled("atlas")
    ? safeHook("atlas", () =>
        createAtlasHook(ctx, {
          directory: ctx.directory,
          backgroundManager,
          isContinuationStopped: (sessionID: string) =>
            stopContinuationGuard?.isStopped(sessionID) ?? false,
          agentOverrides: pluginConfig.agents,
          autoCommit: pluginConfig.ulw_execute?.auto_commit,
        }))
    : null

  const losslessCompaction = isHookEnabled("lossless-compaction") && pluginConfig.knowledge?.enabled !== false && pluginConfig.knowledge?.lossless_compaction !== false
    ? safeHook("lossless-compaction", () => createLosslessCompactionHook(ctx))
    : null

  // Network cuts (fork roadmap 0.15): created before the stall watchdog, which asks it whether a stall is a cut.
  const networkGuard = safeCreateHook("network-guard", () => createPluginNetworkGuard(ctx, pluginConfig), { enabled: safeHookEnabled })

  const stallWatchdog = isHookEnabled("stall-watchdog") && pluginConfig.stall?.enabled !== false
    ? safeHook("stall-watchdog", () => createPluginStallWatchdogHook(ctx, pluginConfig))
    : null

  return {
    stopContinuationGuard,
    compactionContextInjector,
    compactionTodoPreserver,
    losslessCompaction,
    networkGuard,
    stallWatchdog,
    todoContinuationEnforcer,
    unstableAgentBabysitter,
    backgroundNotificationHook,
    atlasHook,
  }
}
