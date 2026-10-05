/**
 * Low-RAM admission gate for new subagents (fork roadmap 0.15 E). Below `low_memory_mb` (or `low_memory_ratio` of the
 * total) a new subagent waits in its queue and memory is re-checked every few seconds; it is admitted again only from
 * `resume_memory_mb` (hysteresis, so admission does not flap around one threshold). With no subagent running at all
 * one is let through, so the gate can never deadlock the work; the waiting task's own ancestors do not count as running
 * (a parent waiting on its child would otherwise hold it forever). Memory held by other programs can keep the system
 * low for good, so no subagent waits longer than `maxWaitMs`: then it starts anyway and the user is told. Linux PSI
 * `some avg10` (share of time some task stalled on memory) also counts as low, with its own hysteresis. The user is
 * told once per waiting spell, and not at all while the high-memory warning of 0.9b is already on screen.
 */
import type { MemorySample } from "../resume/memory-watch"

export type MemoryGateOptions = {
  readonly lowMemoryMb: number
  readonly lowMemoryRatio: number
  readonly resumeMemoryMb: number
  readonly sample: () => MemorySample
  /** Subagents (background and sync) currently running, leaving out the ancestors of the task `label` names. */
  readonly runningCount: (label: string) => number
  readonly toast: (message: string) => void | Promise<void>
  /** True while 0.9b's high-memory warning is active: that toast already told the user. */
  readonly isMemoryWarningActive?: () => boolean
  readonly recheckMs?: number
  /** Longest wait of one subagent before it starts anyway (default 4 min). */
  readonly maxWaitMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

const MB = 1024 ** 2
/** After a let-through, other waiters keep waiting this long for it to show up as running. */
const LET_THROUGH_WINDOW_MS = 30_000
const DEFAULT_MAX_WAIT_MS = 4 * 60_000
/** PSI `some avg10` above this (percent of time some task waited on memory) is memory pressure; below the resume line it ends. */
const PSI_SOME_LOW = 20
const PSI_SOME_RESUME = 10

export const WAITING_FOR_MEMORY_TOAST = "Esperando memoria libre para lanzar el subagente…"

export function maxWaitToast(minutes: number): string {
  return `La memoria sigue baja tras ${minutes} min de espera; se lanza el subagente igualmente.`
}

export function createMemoryGate(options: MemoryGateOptions) {
  const recheckMs = options.recheckMs ?? 5000
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  let low = false
  let toasted = false
  let letThroughAt = Number.NEGATIVE_INFINITY

  /** Updates the hysteresis state from a fresh sample; true while new subagents must wait. */
  function isLow(): boolean {
    const sample = options.sample()
    const psi = sample.psiSomeAvg10
    if (sample.availableBytes === undefined && psi === undefined) return false
    const availableMb = sample.availableBytes !== undefined ? sample.availableBytes / MB : Number.POSITIVE_INFINITY
    const totalMb = (sample.totalBytes ?? 0) / MB
    const ratioMb = totalMb * options.lowMemoryRatio
    if (!low) {
      low = availableMb < options.lowMemoryMb || availableMb < ratioMb || (psi !== undefined && psi > PSI_SOME_LOW)
    } else {
      // Leave the low state only with the same margin above the ratio line as resume_memory_mb has above low_memory_mb.
      const margin = Math.max(0, options.resumeMemoryMb - options.lowMemoryMb)
      low = availableMb < Math.max(options.resumeMemoryMb, ratioMb + margin) || (psi !== undefined && psi > PSI_SOME_RESUME)
    }
    if (!low) toasted = false
    return low
  }

  return {
    /** Resolves when a new subagent may start; `cancelled` stops waiting (the task was cancelled meanwhile). */
    async waitForMemory(label: string, cancelled: () => boolean = () => false): Promise<void> {
      let logged = false
      const startedAt = now()
      while (!cancelled()) {
        if (!isLow()) return
        // Past the maximum wait one subagent at a time starts anyway, so long waiters do not all start together.
        if (now() - startedAt >= maxWaitMs && now() - letThroughAt > LET_THROUGH_WINDOW_MS) {
          letThroughAt = now()
          const minutes = Math.round(maxWaitMs / 60_000)
          options.log?.("[memory-gate] memory still low after the maximum wait; letting the subagent through", { label, waitedMs: now() - startedAt })
          await Promise.resolve(options.toast(maxWaitToast(minutes))).catch(() => undefined)
          return
        }
        if (options.runningCount(label) === 0 && now() - letThroughAt > LET_THROUGH_WINDOW_MS) {
          letThroughAt = now()
          options.log?.("[memory-gate] memory is low but nothing runs; letting one subagent through", { label })
          return
        }
        if (!logged) {
          logged = true
          options.log?.("[memory-gate] memory is low; subagent waits in the queue", { label })
        }
        if (!toasted) {
          toasted = true
          if (!options.isMemoryWarningActive?.()) await Promise.resolve(options.toast(WAITING_FOR_MEMORY_TOAST)).catch(() => undefined)
        }
        await sleep(recheckMs)
      }
    },

    isLow,
  }
}

export type MemoryGate = ReturnType<typeof createMemoryGate>
