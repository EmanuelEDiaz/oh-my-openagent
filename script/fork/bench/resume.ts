/** Which (task, repeat) runs a resumed bench still has to do, given the results already saved. */
import type { RunResult } from "./types"

export type PendingRun = { readonly taskId: string; readonly repeat: number; readonly nextAttempt: number }

export function pendingRuns(previous: readonly RunResult[], taskIds: readonly string[], repeats: number, infraRetries: number): PendingRun[] {
  const pending: PendingRun[] = []
  for (const taskId of taskIds) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const runs = previous.filter((run) => run.taskId === taskId && run.repeat === repeat)
      if (runs.some((run) => run.pass !== undefined)) continue
      const nextAttempt = runs.length === 0 ? 0 : Math.max(...runs.map((run) => run.attempt)) + 1
      if (nextAttempt > infraRetries) continue
      pending.push({ taskId, repeat, nextAttempt })
    }
  }
  return pending
}
