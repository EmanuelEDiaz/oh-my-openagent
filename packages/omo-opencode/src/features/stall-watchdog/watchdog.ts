/**
 * Detects silent model stalls (fork roadmap 0.8a): a busy session that produces no output for the inactivity window,
 * with no tool running and no managed process it is waiting on. It only detects and records; the owner of each
 * session (sync delegation, background manager, main-session recovery) decides how to recover.
 */

type WatchdogEvent = { type: string; properties?: unknown }

type SessionState = {
  busy: boolean
  lastProgress: number
  runningTools: Set<string>
  reported: boolean
}

export type Stall = { readonly sessionID: string; readonly silentMs: number }

export type StallWatchdogOptions = {
  readonly inactivityMs: number
  readonly now?: () => number
  /** Sessions waiting on a managed background process (0.8b) are waiting, not stalled. */
  readonly hasManagedProcess?: (sessionID: string) => boolean
  /** Stalls tolerated per task before recovery stops and the user is told (default 2). */
  readonly maxStallsPerTask?: number
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function sessionIDOf(properties: unknown): string | undefined {
  const props = record(properties)
  const id = props?.sessionID ?? record(props?.part)?.sessionID ?? record(props?.info)?.sessionID
  return typeof id === "string" ? id : undefined
}

export function createStallWatchdog(options: StallWatchdogOptions) {
  const now = options.now ?? Date.now
  const sessions = new Map<string, SessionState>()
  const stallsByTask = new Map<string, number>()

  function state(sessionID: string): SessionState {
    let current = sessions.get(sessionID)
    if (!current) {
      current = { busy: false, lastProgress: now(), runningTools: new Set(), reported: false }
      sessions.set(sessionID, current)
    }
    return current
  }

  function progress(current: SessionState): void {
    current.lastProgress = now()
    current.reported = false
  }

  return {
    maxStallsPerTask: options.maxStallsPerTask ?? 2,

    observe(event: WatchdogEvent): void {
      const sessionID = sessionIDOf(event.properties)
      if (!sessionID) return
      if (event.type === "session.deleted") {
        sessions.delete(sessionID)
        return
      }
      const current = state(sessionID)
      if (event.type === "session.idle" || event.type === "session.error") {
        current.busy = false
        current.runningTools.clear()
        current.reported = false
        return
      }
      if (event.type === "session.status") {
        const type = record(record(event.properties)?.status)?.type
        if (type === "idle") {
          current.busy = false
          current.runningTools.clear()
          current.reported = false
        } else if (!current.busy) {
          current.busy = true
          progress(current)
        }
        return
      }
      if (event.type === "message.part.updated") {
        const part = record(record(event.properties)?.part)
        if (part?.type === "tool") {
          const callID = typeof part.callID === "string" ? part.callID : String(part.id ?? "")
          const status = record(part.state)?.status
          if (status === "running" || status === "pending") current.runningTools.add(callID)
          else current.runningTools.delete(callID)
        }
        current.busy = true
        progress(current)
        return
      }
      if (event.type === "message.part.delta" || event.type === "message.updated" || event.type.startsWith("session.next.")) {
        current.busy = true
        progress(current)
      }
    },

    /** Newly stalled sessions; each stall is reported once until the session makes progress again. */
    findStalled(): Stall[] {
      const stalls: Stall[] = []
      for (const [sessionID, current] of sessions) {
        if (!current.busy || current.reported || current.runningTools.size > 0) continue
        if (options.hasManagedProcess?.(sessionID)) continue
        const silentMs = now() - current.lastProgress
        if (silentMs <= options.inactivityMs) continue
        current.reported = true
        stalls.push({ sessionID, silentMs })
      }
      return stalls
    },

    /** Sessions currently producing work (busy), for saving resume cards before the process dies. */
    busySessions(): string[] {
      return [...sessions].filter(([, current]) => current.busy).map(([sessionID]) => sessionID)
    },

    isStalled(sessionID: string): boolean {
      return sessions.get(sessionID)?.reported === true
    },

    /** Counts a stall against a task (or session) so retries stop at the budget. */
    recordStall(taskKey: string): number {
      const count = (stallsByTask.get(taskKey) ?? 0) + 1
      stallsByTask.set(taskKey, count)
      return count
    },

    forget(sessionID: string): void {
      sessions.delete(sessionID)
    },
  }
}

export type StallWatchdog = ReturnType<typeof createStallWatchdog>
