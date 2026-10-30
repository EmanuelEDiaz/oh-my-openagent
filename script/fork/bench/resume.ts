/** Which (task, repeat) runs a resumed bench still has to do, given the results already saved. */
import { isQuotaError } from "./score"
import type { RunResult } from "./types"

export type PendingRun = { readonly taskId: string; readonly repeat: number; readonly nextAttempt: number }

export function pendingRuns(previous: readonly RunResult[], taskIds: readonly string[], repeats: number, infraRetries: number): PendingRun[] {
  const pending: PendingRun[] = []
  for (const taskId of taskIds) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      // A quota stop says nothing about the task: it does not use up a retry.
      const runs = previous.filter((run) => run.taskId === taskId && run.repeat === repeat && !(run.error !== undefined && isQuotaError(run.error)))
      if (runs.some((run) => run.pass !== undefined)) continue
      const nextAttempt = runs.length
      if (nextAttempt > infraRetries) continue
      pending.push({ taskId, repeat, nextAttempt })
    }
  }
  return pending
}
