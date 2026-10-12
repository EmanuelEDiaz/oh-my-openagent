/** The processes a kill must never touch, and process groups (fork roadmap 0.21, entrega 1). */
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"

export type ProcStat = { readonly ppid: number; readonly pgid: number; readonly sid: number }

/** `/proc/<pid>/stat`: the command name is in parentheses and may itself contain spaces or parentheses. */
export function parseProcStat(text: string): ProcStat | undefined {
  const fields = text.slice(text.lastIndexOf(")") + 2).split(" ")
  const [ppid, pgid, sid] = [Number(fields[1]), Number(fields[2]), Number(fields[3])]
  return Number.isInteger(ppid) && Number.isInteger(pgid) && Number.isInteger(sid) ? { ppid, pgid, sid } : undefined
}

/** Parent, group and session of a live PID: /proc on Linux, `ps` elsewhere (macOS, BSD). */
export function readProcStat(pid: number): ProcStat | undefined {
  if (process.platform === "linux") {
    try {
      return parseProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"))
    } catch {
      return undefined
    }
  }
  if (process.platform === "win32") return undefined
  const result = spawnSync("ps", ["-o", "ppid=,pgid=,sess=", "-p", String(pid)], { encoding: "utf8", timeout: 2000 })
  const [ppid, pgid, sid] = (result.stdout ?? "").trim().split(/\s+/).map(Number)
  return ppid !== undefined && pgid !== undefined && sid !== undefined && [ppid, pgid, sid].every(Number.isInteger) ? { ppid, pgid, sid } : undefined
}

/** OpenCode (this process), its ancestors up to init, init itself, and OpenCode's process group and session. */
export function protectedProcesses(self: number, read: (pid: number) => ProcStat | undefined = readProcStat): { pids: Set<number>; groups: Set<number> } {
  const pids = new Set<number>([1, self])
  const groups = new Set<number>()
  const own = read(self)
  if (own) {
    groups.add(own.pgid)
    groups.add(own.sid)
  }
  let current = own?.ppid
  for (let hops = 0; current !== undefined && current > 1 && hops < 64 && !pids.has(current); hops++) {
    pids.add(current)
    current = read(current)?.ppid
  }
  return { pids, groups }
}
