/**
 * One loop breaker per OpenCode instance (project folder), shared with the stall watchdog's budget (fork roadmap 0.9b).
 * Several folders can share one server (fork incidents H13).
 */
import { createInstanceRegistry } from "../../shared/instance-registry"
import type { LoopBreaker } from "./breaker"

const breakers = createInstanceRegistry<LoopBreaker>()
let unregisterAll: Array<() => void> = []

/** Registers the breaker of a folder and returns its unregister; `undefined` clears every folder (tests). */
export function setActiveLoopBreaker(breaker: LoopBreaker | undefined, directory = ""): () => void {
  if (!breaker) {
    for (const unregister of unregisterAll) unregister()
    unregisterAll = []
    return () => {}
  }
  const unregister = breakers.register(directory, breaker)
  unregisterAll.push(unregister)
  return unregister
}

export function getActiveLoopBreaker(directory?: string): LoopBreaker | undefined {
  return breakers.get(directory)
}
