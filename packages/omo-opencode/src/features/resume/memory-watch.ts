/**
 * Memory watch (fork roadmap 0.8c). On a machine short of RAM the system's OOM guard (earlyoom) kills the largest
 * process, often OpenCode in a long session. Before that happens: warn the user and save resume cards.
 */
import { readFileSync } from "node:fs"
import { freemem, totalmem } from "node:os"

export type MemorySample = { readonly rss: number; readonly systemUsedRatio: number }

export type MemoryWatchOptions = {
  readonly processLimitBytes: number
  readonly systemUsedRatio: number
  readonly sample?: () => MemorySample
}

export function parseMemAvailable(meminfo: string): number | undefined {
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(meminfo)
  return match?.[1] ? Number(match[1]) * 1024 : undefined
}

/** Process RSS and system memory use; on Linux from MemAvailable, elsewhere from Node's free memory. */
export function sampleMemory(): MemorySample {
  const total = totalmem()
  let available = freemem()
  if (process.platform === "linux") {
    try {
      available = parseMemAvailable(readFileSync("/proc/meminfo", "utf8")) ?? available
    } catch {
      // keep freemem
    }
  }
  return { rss: process.memoryUsage().rss, systemUsedRatio: total > 0 ? 1 - available / total : 0 }
}

function gb(bytes: number): string {
  return `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB`
}

export function createMemoryWatch(options: MemoryWatchOptions) {
  const sample = options.sample ?? sampleMemory
  let high = false
  return {
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
