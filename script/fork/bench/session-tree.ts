/**
 * Whether any subagent of a session is still working (fork incidents H25). A main agent that delegated to background
 * subagents goes idle while it waits, and the plugin wakes it when they finish: the session tree is done only when
 * every child is idle too.
 */
export type SessionStatuses = Readonly<Record<string, { readonly type?: string } | undefined>>

export async function sessionTreeBusy(statuses: SessionStatuses, childrenOf: (sessionID: string) => Promise<readonly string[]>, rootID: string): Promise<boolean> {
  const pending = [...(await childrenOf(rootID))]
  const seen = new Set<string>([rootID])
  while (pending.length > 0) {
    const id = pending.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const type = statuses[id]?.type ?? "idle"
    if (type !== "idle") return true
    pending.push(...(await childrenOf(id)))
  }
  return false
}
