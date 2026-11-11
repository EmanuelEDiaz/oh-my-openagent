/**
 * Memory of a bench run (fork incident H54). omo-run.sh caps the whole run (a systemd scope with MemoryMax and
 * MemorySwapMax), and that cap counts the server plus everything it starts: LSP daemon, tsserver, graders' `bun test`.
 * Watching the server alone missed a kill at 1.4 GB + 512 MB swap with the server at 727 MB. Linux only (cgroup v2).
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type ScopeMemory = { readonly usedMb: number; readonly limitMb: number | undefined }
export type BenchMemory = { readonly serverRssMb: number | undefined; readonly scope: ScopeMemory | undefined }
export type ProcessMemory = { readonly pid: number; readonly name: string; readonly rssMb: number }

/** Restart once the run uses this share of its cap: a task can still peak above what it used between tasks. */
const SCOPE_RESTART_SHARE = 0.7

function readNumber(path: string): number | undefined {
  try {
    const text = readFileSync(path, "utf8").trim()
    if (text === "max") return undefined
    const value = Number(text)
    return Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

const toMb = (bytes: number): number => Math.round(bytes / (1024 * 1024))

/** Memory plus swap of the cgroup this process runs in, and the sum of both caps (undefined when uncapped). */
export function scopeMemory(cgroupRoot = "/sys/fs/cgroup", selfCgroup = "/proc/self/cgroup"): ScopeMemory | undefined {
  let relative: string | undefined
  try {
    relative = readFileSync(selfCgroup, "utf8").split("\n").find((line) => line.startsWith("0::"))?.slice(3).trim()
  } catch {
    return undefined
  }
  if (relative === undefined) return undefined
  const dir = join(cgroupRoot, relative)
  const memory = readNumber(join(dir, "memory.current"))
  if (memory === undefined) return undefined
  const swap = readNumber(join(dir, "memory.swap.current")) ?? 0
  const memoryMax = readNumber(join(dir, "memory.max"))
  const swapMax = readNumber(join(dir, "memory.swap.max")) ?? 0
  return { usedMb: toMb(memory + swap), limitMb: memoryMax === undefined ? undefined : toMb(memoryMax + swapMax) }
}

/** Resident memory of the given processes, largest first; gone ones are skipped. */
export function processMemory(pids: readonly number[], procDir = "/proc"): ProcessMemory[] {
  const found: ProcessMemory[] = []
  for (const pid of pids) {
    try {
      const status = readFileSync(join(procDir, String(pid), "status"), "utf8")
      const kb = status.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]
      const name = status.match(/^Name:\s+(.+)$/m)?.[1]?.trim() ?? "?"
      if (kb !== undefined) found.push({ pid, name, rssMb: Math.round(Number(kb) / 1024) })
    } catch {
      // gone
    }
  }
  return found.sort((left, right) => right.rssMb - left.rssMb)
}

export function needsServerRestart(memory: BenchMemory, limits: { readonly serverRssLimitMb: number }): boolean {
  if (memory.serverRssMb !== undefined && memory.serverRssMb > limits.serverRssLimitMb) return true
  const scope = memory.scope
  return scope !== undefined && scope.limitMb !== undefined && scope.usedMb > scope.limitMb * SCOPE_RESTART_SHARE
}

export function formatMemory(memory: BenchMemory, processes: readonly ProcessMemory[]): string {
  const server = memory.serverRssMb === undefined ? "server ?" : `server ${memory.serverRssMb} MB`
  const scope = memory.scope === undefined ? "run ?" : `run ${memory.scope.usedMb}/${memory.scope.limitMb ?? "uncapped"} MB`
  const top = processes.slice(0, 4).map((process) => `${process.name} ${process.rssMb}`).join(", ")
  return `${server}; ${scope}${top ? `; ${top}` : ""}`
}
