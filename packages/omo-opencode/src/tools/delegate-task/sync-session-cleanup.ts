import { TASK_CLEANUP_DELAY_MS } from "../../features/background-agent/constants"
import { handedBackSyncSessions } from "../../features/claude-code-session-state"
import { isSessionRetained } from "../../features/resume/retention"
import { log } from "../../shared/logger"
import type { OpencodeClient } from "./types"

const pendingDeletionTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function cancelSyncSessionDeletion(sessionID: string): void {
  const timer = pendingDeletionTimers.get(sessionID)
  if (!timer) return
  clearTimeout(timer)
  pendingDeletionTimers.delete(sessionID)
}

export function scheduleSyncSessionDeletion(
  client: OpencodeClient,
  sessionID: string,
  delayMs = TASK_CLEANUP_DELAY_MS,
): void {
  cancelSyncSessionDeletion(sessionID)
  const deleteSession = client?.session?.delete?.bind(client.session)
  if (typeof deleteSession !== "function") return
  const timer = setTimeout(() => {
    pendingDeletionTimers.delete(sessionID)
    // Sessions of a plan that is still active or paused stay for a lossless resume (fork roadmap 0.8c).
    if (isSessionRetained(sessionID)) {
      log("[task] Keeping sync session of an unfinished plan", { sessionID })
      return
    }
    try {
      void deleteSession({ path: { id: sessionID } }).then(() => {
      handedBackSyncSessions.delete(sessionID)
      }).catch((error: unknown) => {
        log("[task] Failed to delete completed sync session:", { sessionID, error: String(error) })
      })
    } catch (error) {
      log("[task] Failed to schedule completed sync session deletion:", { sessionID, error: String(error) })
    }
  }, delayMs)
  pendingDeletionTimers.set(sessionID, timer)
  timer.unref()
}
