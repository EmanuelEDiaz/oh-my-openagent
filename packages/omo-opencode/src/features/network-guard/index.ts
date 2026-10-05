import { isNetworkError } from "@oh-my-opencode/model-core"

import type { NetworkGuard } from "./guard"

export { createNetworkGuard, formatDuration, restoredText, retryAfterMs, unfrozenText } from "./guard"
export type { NetworkGuard, NetworkGuardDeps, NetworkGuardOptions, NetworkGuardSessionView, ProbeVerdict } from "./guard"

// One guard per plugin process, read by the fallback paths (which step aside on network errors) and the stall watchdog.
let current: NetworkGuard | undefined
// `resilience.enabled: false` restores the old behaviour: network errors take the fallback path again.
let enabled = true

export function setNetworkGuard(guard: NetworkGuard | undefined): void {
  current = guard
}

export function getNetworkGuard(): NetworkGuard | undefined {
  return current
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
export function stepAsideForNetwork(sessionID: string | undefined, error: unknown, gaveUp: boolean): boolean {
  if (!enabled || !current || !isNetworkError(error)) return false
  if (sessionID) current.notifyNetworkError(sessionID, error, { gaveUp })
  return true
}
