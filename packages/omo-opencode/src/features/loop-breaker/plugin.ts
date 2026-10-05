/** One loop breaker per plugin process, shared with the stall watchdog's budget (fork roadmap 0.9b). */
import type { LoopBreaker } from "./breaker"

let active: LoopBreaker | undefined

export function setActiveLoopBreaker(breaker: LoopBreaker | undefined): void {
  active = breaker
}

export function getActiveLoopBreaker(): LoopBreaker | undefined {
  return active
}
