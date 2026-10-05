/**
 * Memory watch (fork roadmap 0.8c). On a machine short of RAM the system's OOM guard (earlyoom) kills the largest
 * process, often OpenCode in a long session. Before that happens: warn the user and save resume cards.
 */
import { readFileSync } from "node:fs"
import { freemem, totalmem } from "node:os"

export type MemorySample = {
  readonly rss: number
  readonly systemUsedRatio: number
  /** System memory available to new work (Linux MemAvailable, else free memory); absent in hand-made samples. */
  readonly availableBytes?: number
  readonly totalBytes?: number
  /** Linux PSI (`/proc/pressure/memory`): share of time all / some tasks stalled on memory over the last 10 s. */
  readonly psiFullAvg10?: number
  readonly psiSomeAvg10?: number
}

export type MemoryWatchOptions = {
  readonly processLimitBytes: number
  readonly systemUsedRatio: number
  readonly sample?: () => MemorySample
}

export function parseMemAvailable(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo)
  return match?.[1] ? Number(match[1]) * 1024 : undefined
}

/** `some` / `full` avg10 from `/proc/pressure/memory` (fork 0.15); undefined lines stay undefined. */
export function parsePressure(pressure: string): { some?: number; full?: number } {
  const avg10 = (kind: "some" | "full") => {
    const match = new RegExp(`^${kind} avg10=([\\d.]+)`, "m").exec(pressure)
    return match?.[1] !== undefined ? Number(match[1]) : undefined
  }
  const some = avg10("some")
  const full = avg10("full")
  return { ...(some !== undefined ? { some } : {}), ...(full !== undefined ? { full } : {}) }
}

/** Process RSS and system memory use; on Linux from MemAvailable (+ PSI when the kernel has it), elsewhere from Node's free memory. */
export function sampleMemory(): MemorySample {
  const total = totalmem()
  let available = freemem()
  let pressure: { some?: number; full?: number } = {}
  if (process.platform === "linux") {
    try {
      available = parseMemAvailable(readFileSync("/proc/meminfo", "utf8")) ?? available
    } catch {
      // keep freemem
    }
    try {
      pressure = parsePressure(readFileSync("/proc/pressure/memory", "utf8"))
    } catch {
      // kernel without PSI
    }
  }
  return {
    rss: process.memoryUsage().rss,
    systemUsedRatio: total > 0 ? 1 - available / total : 0,
    availableBytes: available,
    totalBytes: total,
    ...(pressure.full !== undefined ? { psiFullAvg10: pressure.full } : {}),
    ...(pressure.some !== undefined ? { psiSomeAvg10: pressure.some } : {}),
  }
}

function gb(bytes: number): string {
  return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`
}

export function createMemoryWatch(options: MemoryWatchOptions) {
  const sample = options.sample ?? sampleMemory
  let high = false
  return {
    /** True while memory is over a limit (the warning toast was shown for this crossing). */
    isHigh(): boolean {
      return high
    },
    /** A reason when memory just crossed a limit; undefined otherwise (each crossing reported once). */
    check(): { reason: string } | undefined {
      const current = sample()
      const overProcess = current.rss > options.processLimitBytes
      const overSystem = current.systemUsedRatio > options.systemUsedRatio
      if (!overProcess && !overSystem) {
        high = false
        return undefined
      }
      if (high) return undefined
      high = true
      const reason = overProcess
        ? `OpenCode is using ${gb(current.rss)} of memory`
        : `the system is using ${Math.round(current.systemUsedRatio * 100)}% of its memory`
      return { reason }
    },
  }
}
