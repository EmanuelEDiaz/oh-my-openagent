import { isQuotaError } from "./score"

/**
 * Whether any subagent of a session is still working (fork incidents H25). A main agent that delegated to background
 * subagents goes idle while it waits, and the plugin wakes it when they finish: the session tree is done only when
 * every child is idle too.
 */
type SessionStatus = {
  readonly type?: string
  readonly message?: string
  readonly action?: { readonly reason?: string }
  readonly next?: number
}

export type SessionStatuses = Readonly<Record<string, SessionStatus | undefined>>

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

/**
 * OpenCode retries a provider error in silence (session status "retry"), so a spent quota never reaches the transcript:
 * the turn just goes quiet until a watchdog aborts it. Zen marks it with `action.reason: "free_tier_limit"` and puts the
 * reset time in `next`. Resolves a description of the quota stop, if any.
 */
const QUOTA_REASONS = new Set(["free_tier_limit"])

export function quotaExhausted(statuses: SessionStatuses): string | undefined {
  const spent = Object.values(statuses).find((status) =>
    status?.type === "retry" && ((status.action?.reason !== undefined && QUOTA_REASONS.has(status.action.reason)) || (status.message !== undefined && isQuotaError(status.message))))
  if (spent === undefined) return undefined
  const details = [spent.action?.reason, spent.next === undefined ? undefined : `retry after ${new Date(spent.next).toISOString()}`].filter(Boolean)
  return `${spent.message ?? "quota spent"}${details.length > 0 ? ` (${details.join("; ")})` : ""}`
}
