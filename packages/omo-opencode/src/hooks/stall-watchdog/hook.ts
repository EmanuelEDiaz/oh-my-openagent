/**
 * Stall watchdog hook (fork roadmap 0.8a). Feeds session events to the shared watchdog and checks busy sessions on an
 * interval. Subagent sessions are recovered by their owners (sync delegation, background manager), which read the
 * shared watchdog. A stalled main session is stopped, the user is told, and it continues on the next fallback model,
 * at most `maxStallsPerTask` times.
 */
import { createStallWatchdog, setStallWatchdog } from "../../features/stall-watchdog"
import { log } from "../../shared/logger"

const HOOK_NAME = "stall-watchdog"

export type StallWatchdogHookOptions = {
  readonly inactivityMs: number
  readonly checkIntervalMs: number
  readonly maxStallsPerTask: number
  /** A monotonic-clock jump of more than this over the check interval is a freeze (0.15 B); undefined disables it. */
  readonly freezeThresholdMs?: number
}

export type FreezeKind = "freeze" | "suspend"

export type StallWatchdogHookDeps = {
  readonly now?: () => number
  readonly hasManagedProcess?: (sessionID: string) => boolean
  readonly isSubagentSession: (sessionID: string) => boolean
  /** Stop the stalled turn; must not block the hook (it is raced against a timeout by the caller's implementation). */
  readonly abort: (sessionID: string) => Promise<void>
  readonly toast: (message: string) => Promise<void>
  readonly resolveTarget: (sessionID: string) => Promise<{ agent?: string; model?: string }>
  readonly fallbackModels: (sessionID: string, agent: string | undefined) => readonly string[]
  readonly continueSession: (sessionID: string, input: { agent?: string; model?: string; text: string }) => Promise<void>
  /** Save a resume card and pause the work when the stall budget is spent (0.8c). */
  readonly pause?: (sessionID: string, reason: string, attempts: Array<{ model?: string; outcome: string }>) => Promise<void>
  /** The task's retry budget shared with the loop breaker (0.9b); exhausted → pause like the stall cap. */
  readonly chargeBudget?: (sessionID: string) => { used: number; max: number; exhausted: boolean } | undefined
  /** The session waits for the network (network guard, 0.15): not stalled. */
  readonly isWaiting?: (sessionID: string) => boolean
  /** OpenCode's retry message is a network cut and network resilience is on: its backoff is a wait (0.15). */
  readonly isNetworkRetry?: (message: unknown) => boolean
  /**
   * Asked before a stall is recovered: true when the network or a freeze caused it and the network guard took over
   * on the same model, so no stall is counted, no budget charged and no model switched (0.15 A4).
   */
  readonly takeOverStall?: (sessionID: string, opts: { stopped: boolean }) => Promise<boolean>
  /** The process was frozen or the system suspended; busy sessions may have dead sockets (0.15 B). */
  readonly onFreeze?: (sessionIDs: readonly string[], seconds: number, kind: FreezeKind) => void
  readonly monotonicNow?: () => number
  readonly wallNow?: () => number
}

const STREAM_TIMEOUT = /SSE read timed out|ProviderResponseStreamError/i

function streamTimeoutSession(event: { type: string; properties?: unknown }): string | undefined {
  if (event.type !== "session.error") return undefined
  const properties = event.properties as { sessionID?: unknown; error?: unknown } | undefined
  if (typeof properties?.sessionID !== "string") return undefined
  return STREAM_TIMEOUT.test(JSON.stringify(properties.error ?? "")) ? properties.sessionID : undefined
}

function minutes(ms: number): string {
  return `${Math.round(ms / 60_000)} min`
}

export function createStallWatchdogHook(options: StallWatchdogHookOptions, deps: StallWatchdogHookDeps) {
  const watchdog = createStallWatchdog({
    inactivityMs: options.inactivityMs,
    maxStallsPerTask: options.maxStallsPerTask,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.hasManagedProcess ? { hasManagedProcess: deps.hasManagedProcess } : {}),
    ...(deps.isWaiting ? { isWaiting: deps.isWaiting } : {}),
    ...(deps.isNetworkRetry ? { isNetworkRetry: deps.isNetworkRetry } : {}),
  })
  setStallWatchdog(watchdog)

  async function recoverMainSession(sessionID: string, silentMs: number, alreadyStopped = false): Promise<void> {
    const networkCut = await deps.takeOverStall?.(sessionID, { stopped: alreadyStopped }).catch((error) => {
      log(`[${HOOK_NAME}] network check failed`, { sessionID, error: String(error) })
      return false
    })
    if (networkCut) {
      log(`[${HOOK_NAME}] stall caused by the network or a freeze; the network guard continues on the same model`, { sessionID })
      return
    }
    const stalls = watchdog.recordStall(sessionID)
    if (!alreadyStopped) {
      await deps.abort(sessionID).catch((error) => log(`[${HOOK_NAME}] abort failed`, { sessionID, error: String(error) }))
    }
    const budget = deps.chargeBudget?.(sessionID)
    if (stalls > watchdog.maxStallsPerTask || budget?.exhausted) {
      const target = await deps.resolveTarget(sessionID).catch(() => ({} as { agent?: string; model?: string }))
      const why = budget?.exhausted && stalls <= watchdog.maxStallsPerTask ? `the task's retry budget is spent (${budget.used}/${budget.max})` : `the model stalled ${stalls} times`
      await deps.pause?.(sessionID, why, [{ ...(target.model ? { model: target.model } : {}), outcome: `stalled ${stalls} times (no output)` }])
        .catch((error) => log(`[${HOOK_NAME}] pause failed`, { sessionID, error: String(error) }))
      await deps.toast(`Stopped: ${why}. The work is saved; resume it with /omo-resume (optionally after switching models with /omo-models).`)
      return
    }
    const target = await deps.resolveTarget(sessionID).catch(() => ({} as { agent?: string; model?: string }))
    const fallbacks = deps.fallbackModels(sessionID, target.agent).filter((model) => model !== target.model)
    const model = fallbacks[stalls - 1] ?? fallbacks.at(-1) ?? target.model
    const what = silentMs > 0 ? `no output for ${minutes(silentMs)}` : "the stream timed out"
    await deps.toast(`The model stalled (${what}); stopped it and continuing on ${model ?? "the same model"}.`)
    await deps.continueSession(sessionID, {
      ...(target.agent ? { agent: target.agent } : {}),
      ...(model ? { model } : {}),
      text: `[${HOOK_NAME}] Your previous response stalled (${what}) and was stopped. Continue the task from where it stopped; do not repeat work that is already done.`,
    })
  }

  const monotonicNow = deps.monotonicNow ?? (() => performance.now())
  const wallNow = deps.wallNow ?? Date.now
  let lastMonotonic = monotonicNow()
  let lastWall = wallNow()

  /**
   * Freeze detection (0.15 B) on the monotonic clock, which NTP does not move: a tick that arrives far later than the
   * interval means the process was stopped (RAM pressure, SIGSTOP). A wall-clock jump the monotonic clock did not see
   * is a system suspend. Either way the silence was not the model's.
   */
  function detectFreeze(): void {
    const monotonic = monotonicNow()
    const wall = wallNow()
    const monotonicElapsed = monotonic - lastMonotonic
    const wallElapsed = wall - lastWall
    lastMonotonic = monotonic
    lastWall = wall
    if (options.freezeThresholdMs === undefined) return
    const limit = options.checkIntervalMs + options.freezeThresholdMs
    const kind: FreezeKind | undefined = monotonicElapsed > limit ? "freeze" : wallElapsed > limit ? "suspend" : undefined
    if (!kind) return
    const elapsed = kind === "freeze" ? monotonicElapsed : wallElapsed
    const seconds = Math.round((elapsed - options.checkIntervalMs) / 1000)
    const sessions = watchdog.resetBusyProgress()
    log(`[${HOOK_NAME}] process ${kind === "freeze" ? "frozen" : "suspended"} for ${seconds} s`, { busySessions: sessions.length })
    deps.onFreeze?.(sessions, seconds, kind)
  }

  async function check(): Promise<void> {
    detectFreeze()
    for (const stall of watchdog.findStalled()) {
      if (deps.isSubagentSession(stall.sessionID)) {
        log(`[${HOOK_NAME}] subagent stalled; its owner will retry`, { sessionID: stall.sessionID, silentMs: stall.silentMs })
        continue
      }
      log(`[${HOOK_NAME}] main session stalled`, { sessionID: stall.sessionID, silentMs: stall.silentMs })
      await recoverMainSession(stall.sessionID, stall.silentMs).catch((error) =>
        log(`[${HOOK_NAME}] recovery failed`, { sessionID: stall.sessionID, error: String(error) }))
    }
  }

  const timer = setInterval(() => void check(), options.checkIntervalMs)
  timer.unref?.()

  return {
    event: async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
      watchdog.observe(input.event)
      // OpenCode's chunkTimeout already cut the stream and its own retries are spent: continue on the next model.
      const sessionID = streamTimeoutSession(input.event)
      if (sessionID && !deps.isSubagentSession(sessionID)) {
        log(`[${HOOK_NAME}] main session ended on a stream timeout`, { sessionID })
        void recoverMainSession(sessionID, 0, true).catch((error) =>
          log(`[${HOOK_NAME}] recovery failed`, { sessionID, error: String(error) }))
      }
    },
    check,
    dispose(): void {
      clearInterval(timer)
      setStallWatchdog(undefined)
    },
  }
}
