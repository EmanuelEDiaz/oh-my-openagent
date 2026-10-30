/**
 * Which fallback path owns a background-task session (fork plan real-use-incidents A3 follow-up).
 *
 * With runtime_fallback on by default, a background task's session error used to reach two fallback paths: the
 * BackgroundManager (features/background-agent/fallback-retry-handler.ts) and runtime-fallback. The BackgroundManager
 * is the owner: it knows the task, its attempt count and its own fallback chain, relaunches the work in a fresh
 * session and tells the parent session. runtime-fallback only works per session (prompting the same session again),
 * so it steps aside for every session the BackgroundManager tracks. Sync subagents and the main session stay with
 * runtime-fallback. Network cuts keep going to the network guard first on both paths.
 */
type Owner = (sessionID: string) => boolean

let owner: Owner | undefined

export function setBackgroundSessionOwner(next: Owner | undefined): void {
  owner = next
}

export function clearBackgroundSessionOwner(current: Owner): void {
  if (owner === current) owner = undefined
}

export function isBackgroundTaskSession(sessionID: string): boolean {
  try {
    return owner?.(sessionID) ?? false
  } catch {
    return false
  }
}
