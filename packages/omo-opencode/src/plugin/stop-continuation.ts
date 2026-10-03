import { getWorkForSession, pauseBoulderWork } from "../features/boulder-state"
import { resumeIdFor } from "../features/resume/pause"
import { log } from "../shared"

type StopContinuationHooks = {
  readonly keywordDetector?: {
    readonly clearSession?: (sessionID: string) => void
  } | null
  readonly stopContinuationGuard?: {
    readonly stop?: (sessionID: string) => void
  } | null
  readonly todoContinuationEnforcer?: {
    readonly cancelAllCountdowns: () => void
  } | null
  readonly goal?: {
    readonly clearGoal: (sessionID: string) => boolean
  } | null
}

export function stopContinuation(args: {
  readonly directory: string
  readonly hooks: StopContinuationHooks
  readonly sessionID: string
}): void {
  const { directory, hooks, sessionID } = args
  hooks.keywordDetector?.clearSession?.(sessionID)
  hooks.stopContinuationGuard?.stop?.(sessionID)
  hooks.todoContinuationEnforcer?.cancelAllCountdowns()
  hooks.goal?.clearGoal(sessionID)
  // Pause, never delete: the plan and its progress stay resumable with /omo-resume or /ulw-execute (fork roadmap 0.8c).
  const work = getWorkForSession(directory, sessionID)
  if (work) pauseBoulderWork(directory, work.work_id, { reason: "stopped by the user (/stop-continuation)", resumeId: resumeIdFor(sessionID) })
  log("[stop-continuation] All continuation mechanisms stopped", { sessionID, pausedWork: work?.work_id })
}
