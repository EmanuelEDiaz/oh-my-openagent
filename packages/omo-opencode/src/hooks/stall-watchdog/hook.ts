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
}

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
  })
  setStallWatchdog(watchdog)

  async function recoverMainSession(sessionID: string, silentMs: number, alreadyStopped = false): Promise<void> {
    const stalls = watchdog.recordStall(sessionID)
    if (!alreadyStopped) {
      await deps.abort(sessionID).catch((error) => log(`[${HOOK_NAME}] abort failed`, { sessionID, error: String(error) }))
    }
    if (stalls > watchdog.maxStallsPerTask) {
      await deps.toast(`Stopped: the model stalled ${stalls} times (no output for ${minutes(silentMs)}). Send a message to continue or switch models with /omo-models.`)
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

  async function check(): Promise<void> {
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
