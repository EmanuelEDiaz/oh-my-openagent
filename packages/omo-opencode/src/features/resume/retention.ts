/**
 * Subagent sessions of an unfinished plan are kept (fork roadmap 0.8c). The plugin deletes finished subagent sessions
 * after 10 minutes; for a plan that is still active or paused they are evidence a resume may need, so they stay
 * until the work is completed or abandoned.
 */
import { getBoulderWorks, readBoulderState } from "@oh-my-opencode/boulder-state"

const directories = new Set<string>()

export function registerRetentionDirectory(directory: string): void {
  directories.add(directory)
}

export function unregisterRetentionDirectory(directory: string): void {
  directories.delete(directory)
}

// boulder.json stores ids with a platform prefix ("opencode:ses_…").
function bare(sessionID: string): string {
  return sessionID.replace(/^[a-z][\w-]*:/i, "")
}

export function isSessionRetained(sessionID: string): boolean {
  const target = bare(sessionID)
  for (const directory of directories) {
    const state = (() => {
      try {
        return readBoulderState(directory)
      } catch {
        return null
      }
    })()
    if (!state) continue
    for (const work of getBoulderWorks(state)) {
      if (work.status === "completed" || work.status === "abandoned") continue
      if (work.session_ids?.some((id) => bare(id) === target)) return true
      if (Object.values(work.task_sessions ?? {}).some((task) => bare(task.session_id) === target)) return true
    }
  }
  return false
}
