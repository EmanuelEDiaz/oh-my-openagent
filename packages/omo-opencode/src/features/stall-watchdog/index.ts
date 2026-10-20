import { createInstanceRegistry } from "../../shared/instance-registry"
import type { StallWatchdog } from "./watchdog"

export { createStallWatchdog } from "./watchdog"
export type { Stall, StallWatchdog, StallWatchdogOptions } from "./watchdog"

// One watchdog per OpenCode instance (project folder), created by the stall-watchdog hook and read by the session
// owners (sync delegation, background manager) that decide how to recover. Several folders can share one server
// (fork incidents H13).
const watchdogs = createInstanceRegistry<StallWatchdog>()
let unregisterAll: Array<() => void> = []

/** Registers the watchdog of a folder and returns its unregister; `undefined` clears every folder (tests). */
export function setStallWatchdog(watchdog: StallWatchdog | undefined, directory = ""): () => void {
  if (!watchdog) {
    for (const unregister of unregisterAll) unregister()
    unregisterAll = []
    return () => {}
  }
  const unregister = watchdogs.register(directory, watchdog)
  unregisterAll.push(unregister)
  return unregister
}

/** The watchdog of `directory`; without one, the most recent live instance's. */
export function getStallWatchdog(directory?: string): StallWatchdog | undefined {
  return watchdogs.get(directory)
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
export function stallBudgetExceeded(error: string, taskKey: string, directory?: string): boolean {
  const watchdog = watchdogs.get(directory)
  if (!watchdog || !error.startsWith(STALL_ERROR_PREFIX)) return false
  return watchdog.recordStall(taskKey) > watchdog.maxStallsPerTask
}
