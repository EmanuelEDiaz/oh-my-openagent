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
 * Kills recorded by earlyoom, from the log its optional `-N` hook writes (one "<pid> <name> <date -Is>" line per kill;
 * see docs/fork/plans/resilience-network-ram.md, "Guía opcional para earlyoom"). Missing log → empty list.
 */
export function earlyoomLogPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const base = env.XDG_STATE_HOME || (env.HOME ? `${env.HOME}/.local/state` : undefined)
  return base ? `${base}/omo/earlyoom-kills.log` : undefined
}

export type EarlyoomKill = { readonly pid: number; readonly at: number }

/** Lines without a readable timestamp are dropped: a kill that cannot be dated cannot be told from an old one. */
export function readEarlyoomKills(path = earlyoomLogPath(), read: ProcReader = readProc): readonly EarlyoomKill[] {
  if (!path) return []
  try {
    return read(path).split("\n").flatMap((line) => {
      const fields = line.trim().split(/\s+/)
      const pid = Number(fields[0])
      // The name may contain spaces, so the timestamp is the last field.
      const at = fields.length >= 3 ? Date.parse(fields[fields.length - 1]!) : Number.NaN
      return Number.isInteger(pid) && pid > 0 && Number.isFinite(at) ? [{ pid, at }] : []
    })
  } catch {
    return []
  }
}

/**
 * Whether earlyoom killed the process of this marker: same pid, killed after its last heartbeat (the process was alive
 * then, so an older kill of that pid number belonged to a previous process) and not long after it (a much later kill
 * hit a process that reused the pid; earlyoom acts as soon as memory runs out, which is also what stops the
 * heartbeat). `date -Is` drops the milliseconds, hence the one-second slack. Callers check the boot themselves.
 */
export const EARLYOOM_KILL_WINDOW_MS = 30 * 60_000

export function wasKilledByEarlyoom(kills: readonly EarlyoomKill[], marker: { readonly pid: number; readonly heartbeat: number }): boolean {
  return kills.some((kill) => kill.pid === marker.pid && kill.at >= marker.heartbeat - 1000 && kill.at <= marker.heartbeat + EARLYOOM_KILL_WINDOW_MS)
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
