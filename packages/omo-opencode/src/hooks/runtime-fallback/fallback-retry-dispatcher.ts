import type { AutoRetryHelpers } from "./auto-retry"
import type { AutoRetryDispatchOutcome, HookDeps, FallbackState } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import { prepareFallback } from "./fallback-state"
import { restoreFallbackState, snapshotFallbackState } from "./fallback-state-snapshot"
import { getNetworkGuard } from "../../features/network-guard"

type DispatchFallbackRetryOptions = {
  sessionID: string
  state: FallbackState
  fallbackModels: string[]
  resolvedAgent?: string
  source: string
  /** The failed model is listed by its provider but not served (model_not_found): say so in the toast. */
  notServed?: boolean
}

function shortModelName(model: string): string {
  return model.split("/").pop() || model
}

function resolveDispatchMessage(result: AutoRetryDispatchOutcome, newModel: string, notServedModel?: string): string {
  const modelName = shortModelName(newModel)
  if (notServedModel !== undefined) return `${shortModelName(notServedModel)} is not served → switched to ${modelName}`
  if (result.status === "queued") return `Fallback queued for ${modelName}`
  if (result.status === "possibly-accepted") return `Fallback dispatch may have been accepted for ${modelName}`
  return `Switched to ${modelName} for next request`
}

export async function dispatchFallbackRetry(
  deps: HookDeps,
  helpers: AutoRetryHelpers,
  options: DispatchFallbackRetryOptions,
): Promise<void> {
  // Timeouts can fire while the session waits for the network; a fallback then would only burn the chain.
  if (getNetworkGuard()?.isWaiting(options.sessionID)) {
    log(`[${HOOK_NAME}] Fallback skipped - session is waiting for the network`, { sessionID: options.sessionID, source: options.source })
    return
  }
  const snapshot = snapshotFallbackState(options.state)
  const failedModel = options.state.currentModel
  const result = prepareFallback(
    options.sessionID,
    options.state,
    options.fallbackModels,
    deps.config,
  )

  if (result.success && result.newModel) {
    const rawDispatchOutcome = await helpers.autoRetryWithFallback(
      options.sessionID,
      result.newModel,
      options.resolvedAgent,
      options.source,
    )
    const dispatchOutcome = rawDispatchOutcome ?? {
      accepted: true,
      status: "dispatched",
    }
    if (rawDispatchOutcome === undefined) {
      log(`[${HOOK_NAME}] Fallback dispatch returned no outcome; treating as accepted for compatibility`, {
        sessionID: options.sessionID,
        source: options.source,
      })
    }
    if (!dispatchOutcome.accepted) {
      restoreFallbackState(options.state, snapshot)
      log(`[${HOOK_NAME}] Fallback dispatch was not accepted`, {
        sessionID: options.sessionID,
        source: options.source,
        status: dispatchOutcome.status,
        reason: dispatchOutcome.reason,
      })
      return
    }
    if (deps.config.notify_on_fallback) {
      await deps.ctx.client.tui
        .showToast({
          body: {
            title: "Model Fallback",
            message: resolveDispatchMessage(dispatchOutcome, result.newModel, options.notServed ? failedModel : undefined),
            variant: "warning",
            duration: 5000,
          },
        })
        .catch(() => {})
    }
    return
  }

  log(`[${HOOK_NAME}] Fallback preparation failed`, {
    sessionID: options.sessionID,
    source: options.source,
    error: result.error,
  })
}
