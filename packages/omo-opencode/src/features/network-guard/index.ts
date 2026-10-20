import { isNetworkError } from "@oh-my-opencode/model-core"

import { createInstanceRegistry } from "../../shared/instance-registry"
import type { NetworkGuard } from "./guard"

export { createNetworkGuard, formatDuration, restoredText, retryAfterMs, unfrozenText } from "./guard"
export type { NetworkGuard, NetworkGuardDeps, NetworkGuardOptions, NetworkGuardSessionView, ProbeVerdict, SessionOwner } from "./guard"

// One guard per OpenCode instance (project folder), read by the fallback paths (which step aside on network errors)
// and the stall watchdog. Several folders can share one server (fork incidents H13).
const guards = createInstanceRegistry<NetworkGuard>()
let unregisterAll: Array<() => void> = []
// `resilience.enabled: false` restores the old behaviour: network errors take the fallback path again.
let enabled = true

/** Registers the guard of a folder and returns its unregister; `undefined` clears every folder (tests). */
export function setNetworkGuard(guard: NetworkGuard | undefined, directory = ""): () => void {
  if (!guard) {
    for (const unregister of unregisterAll) unregister()
    unregisterAll = []
    return () => {}
  }
  const unregister = guards.register(directory, guard)
  unregisterAll.push(unregister)
  return unregister
}

/** The guard of `directory`; without one, the most recent live instance's. */
export function getNetworkGuard(directory?: string): NetworkGuard | undefined {
  return guards.get(directory)
}

// Listeners of guard state changes (the TUI sidebar mirror); the guard and the mirror are created in different places.
const changeListeners = new Set<() => void>()

export function onNetworkGuardChange(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export function notifyNetworkGuardChange(): void {
  for (const listener of [...changeListeners]) listener()
}

export function setNetworkResilienceEnabled(value: boolean): void {
  enabled = value
}

export function isNetworkResilienceEnabled(): boolean {
  return enabled
}

/**
 * For fallback paths: true when the error is a network cut, so the caller must not switch models, spend an attempt
 * or cool a model down. The guard is told and takes over. Without a running guard (creation failed, disabled hook)
 * nobody would wait the cut out, so the fallback path keeps the error. `gaveUp`: OpenCode's own retry is over.
 */
export function stepAsideForNetwork(sessionID: string | undefined, error: unknown, gaveUp: boolean, directory?: string): boolean {
  const current = guards.get(directory)
  if (!enabled || !current || !isNetworkError(error)) return false
  if (sessionID) current.notifyNetworkError(sessionID, error, { gaveUp })
  return true
}
