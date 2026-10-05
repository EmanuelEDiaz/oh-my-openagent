/**
 * Low-RAM admission gate for new subagents (fork roadmap 0.15 E). Below `low_memory_mb` (or `low_memory_ratio` of the
 * total) a new subagent waits in its queue and memory is re-checked every few seconds; it is admitted again only from
 * `resume_memory_mb` (hysteresis, so admission does not flap around one threshold). With no subagent running at all
 * one is let through, so the gate can never deadlock the work. The user is told once per waiting spell, and not at all
 * while the high-memory warning of 0.9b is already on screen.
 */
import type { MemorySample } from "../resume/memory-watch"

export type MemoryGateOptions = {
  readonly lowMemoryMb: number
  readonly lowMemoryRatio: number
  readonly resumeMemoryMb: number
  readonly sample: () => MemorySample
  /** Subagents (background and sync) currently running. */
  readonly runningCount: () => number
  readonly toast: (message: string) => void | Promise<void>
  /** True while 0.9b's high-memory warning is active: that toast already told the user. */
  readonly isMemoryWarningActive?: () => boolean
  readonly recheckMs?: number
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  readonly log?: (message: string, data?: Record<string, unknown>) => void
}

const MB = 1024 ** 2
/** After a let-through, other waiters keep waiting this long for it to show up as running. */
const LET_THROUGH_WINDOW_MS = 30_000

export const WAITING_FOR_MEMORY_TOAST = "Esperando memoria libre para lanzar el subagente…"

export function createMemoryGate(options: MemoryGateOptions) {
  const recheckMs = options.recheckMs ?? 5000
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  let low = false
  let toasted = false
  let letThroughAt = Number.NEGATIVE_INFINITY

  /** Updates the hysteresis state from a fresh sample; true while new subagents must wait. */
  function isLow(): boolean {
    const sample = options.sample()
    if (sample.availableBytes === undefined) return false
    const availableMb = sample.availableBytes / MB
    const totalMb = (sample.totalBytes ?? 0) / MB
    const ratioMb = totalMb * options.lowMemoryRatio
    if (!low) {
      low = availableMb < options.lowMemoryMb || availableMb < ratioMb
    } else {
      // Leave the low state only with the same margin above the ratio line as resume_memory_mb has above low_memory_mb.
      const margin = Math.max(0, options.resumeMemoryMb - options.lowMemoryMb)
      low = availableMb < Math.max(options.resumeMemoryMb, ratioMb + margin)
    }
    if (!low) toasted = false
    return low
  }

  return {
    /** Resolves when a new subagent may start; `cancelled` stops waiting (the task was cancelled meanwhile). */
    async waitForMemory(label: string, cancelled: () => boolean = () => false): Promise<void> {
      let logged = false
      while (!cancelled()) {
        if (!isLow()) return
        if (options.runningCount() === 0 && now() - letThroughAt > LET_THROUGH_WINDOW_MS) {
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
