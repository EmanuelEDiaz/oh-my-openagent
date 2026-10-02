import type { StallWatchdog } from "./watchdog"

export { createStallWatchdog } from "./watchdog"
export type { Stall, StallWatchdog, StallWatchdogOptions } from "./watchdog"

// One watchdog per plugin process, created by the stall-watchdog hook and read by the session owners
// (sync delegation, background manager) that decide how to recover.
let current: StallWatchdog | undefined

export function setStallWatchdog(watchdog: StallWatchdog | undefined): void {
  current = watchdog
}

export function getStallWatchdog(): StallWatchdog | undefined {
  return current
}

export const STALL_ERROR_PREFIX = "Model stalled"

/** Tool-facing message; "timeout" keeps it on the retryable path of the model error classifier. */
export function stallErrorMessage(sessionID: string): string {
  return `${STALL_ERROR_PREFIX}: no output from the model (stream timeout) in session ${sessionID}; it was stopped`
}

/**
 * Counts a stall reported by a session owner against its task and says whether the budget is spent, so a stalled
 * task is retried on the next model at most `maxStallsPerTask` times.
 */
export function stallBudgetExceeded(error: string, taskKey: string): boolean {
  const watchdog = current
  if (!watchdog || !error.startsWith(STALL_ERROR_PREFIX)) return false
  return watchdog.recordStall(taskKey) > watchdog.maxStallsPerTask
}
