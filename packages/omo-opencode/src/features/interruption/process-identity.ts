/**
 * Who a pid really is (fork roadmap 0.15): on Linux the kernel start time of a pid and the boot id tell a dead
 * OpenCode from a pid that was reused by another process or by another boot. Elsewhere these reads return undefined
 * and callers fall back to "is the pid alive" plus the heartbeat age.
 */
import { readFileSync } from "node:fs"

export type ProcReader = (path: string) => string

const readProc: ProcReader = (path) => readFileSync(path, "utf8")

/** Field 22 of `/proc/<pid>/stat` (start time in clock ticks after boot); the command name may contain spaces. */
export function parseProcStartTime(stat: string): number | undefined {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  // fields[0] is field 3 (state), so field 22 is index 19.
  const value = Number(fields[19])
  return Number.isFinite(value) && fields[19] !== undefined && fields[19] !== "" ? value : undefined
}

export function readProcStartTime(pid: number | "self", read: ProcReader = readProc): number | undefined {
  try {
    return parseProcStartTime(read(`/proc/${pid}/stat`))
  } catch {
    return undefined
  }
}

export function readBootId(read: ProcReader = readProc): string | undefined {
  try {
    return read("/proc/sys/kernel/random/boot_id").trim() || undefined
  } catch {
    return undefined
  }
}

/** `oom_kill` from `/proc/vmstat`: how many processes the kernel OOM killer ended since boot. */
export function readOomKills(read: ProcReader = readProc): number | undefined {
  try {
    const match = /^oom_kill (\d+)$/m.exec(read("/proc/vmstat"))
    return match?.[1] !== undefined ? Number(match[1]) : undefined
  } catch {
    return undefined
  }
}

/**
 * Pids killed by earlyoom, from the log its optional `-N` hook writes (one "<pid> <name>" line per kill; see
 * docs/fork/plans/resilience-network-ram.md, "Guía opcional para earlyoom"). Missing log → empty set.
 */
export function earlyoomLogPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.XDG_STATE_HOME || (env.HOME ? `${env.HOME}/.local/state` : undefined)
  return base ? `${base}/omo/earlyoom-kills.log` : undefined
}

export function readEarlyoomKills(path = earlyoomLogPath(), read: ProcReader = readProc): ReadonlySet<number> {
  if (!path) return new Set()
  try {
    return new Set(read(path).split("\n").map((line) => Number(line.trim().split(/\s+/)[0])).filter((pid) => Number.isInteger(pid) && pid > 0))
  } catch {
    return new Set()
  }
}

/** `process.kill(pid, 0)`: ESRCH means gone; EPERM means it exists but belongs to someone else. */
export function isPidAlive(pid: number, kill: (pid: number, signal: 0) => void = (target, signal) => void process.kill(target, signal)): boolean {
  try {
    kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}
