import { copyFileSync, existsSync, readdirSync, readlinkSync, realpathSync, statfsSync, statSync } from "node:fs"
import { dirname } from "node:path"

import { loadSqlite } from "../../shared/bun-sqlite-shim"
import type { KnowledgeStore } from "./store"

const DAY_MS = 86_400_000
const PINNED_PREFIX = "pinned:"

export type OpencodeDbReport = {
  readonly path: string
  readonly bytes: number
  readonly reclaimableBytes: number
  readonly sessions: number
  readonly unreferencedOlderThanRetention: number
}

export type KnowledgeReport = {
  readonly project: { readonly path: string; readonly documents: number; readonly sources: number; readonly bytes: number } | null
  readonly sessions: { readonly path: string; readonly documents: number; readonly sessions: number; readonly pinned: number; readonly bytes: number } | null
  readonly opencodeDb: OpencodeDbReport | null
}

export async function inspectOpencodeDb(path: string, pinned: ReadonlySet<string>, retentionDays: number, now: number): Promise<OpencodeDbReport | null> {
  if (!existsSync(path)) return null
  const sqlite = await loadSqlite()
  if (sqlite === null) return null
  const db = new sqlite.Database(path, { readonly: true })
  try {
    const pageSize = (db.query("PRAGMA page_size").get() as { page_size: number }).page_size
    const freePages = (db.query("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count
    const sessions = db.query("SELECT id, time_updated AS updated FROM session").all() as { id: string; updated: number }[]
    return {
      path,
      bytes: statSync(path).size,
      reclaimableBytes: pageSize * freePages,
      sessions: sessions.length,
      unreferencedOlderThanRetention: sessions.filter((session) => !pinned.has(session.id) && now - session.updated > retentionDays * DAY_MS).length,
    }
  } finally {
    db.close()
  }
}

export function pinnedIds(store: KnowledgeStore | null): Set<string> {
  return new Set((store?.listMeta(PINNED_PREFIX) ?? []).map(([key]) => key.slice(PINNED_PREFIX.length)))
}

/** Linux: another process holding the file open means OpenCode is running (it keeps the database open). */
export function processesUsing(path: string): number[] | null {
  if (process.platform !== "linux" || !existsSync("/proc")) return null
  const target = realpathSync(path)
  const holders: number[] = []
  for (const entry of readdirSync("/proc")) {
    const pid = Number(entry)
    if (!Number.isInteger(pid) || pid === process.pid) continue
    let fds: string[]
    try {
      fds = readdirSync(`/proc/${pid}/fd`)
    } catch {
      continue
    }
    if (fds.some((fd) => {
      try {
        return readlinkSync(`/proc/${pid}/fd/${fd}`) === target
      } catch {
        return false
      }
    })) holders.push(pid)
  }
  return holders
}

export type VacuumResult =
  | { readonly status: "done"; readonly before: number; readonly after: number; readonly backupPath: string }
  | { readonly status: "refused"; readonly reason: string }

export type VacuumDeps = {
  readonly processesUsing?: (path: string) => number[] | null
  readonly freeBytes?: (directory: string) => number
  readonly now?: () => Date
}

function defaultFreeBytes(directory: string): number {
  const stats = statfsSync(directory)
  return stats.bavail * stats.bsize
}

/**
 * Compacts OpenCode's database. Only runs when nothing has it open, there is room for a backup plus
 * the rebuilt copy, and after a backup is written next to it. Callers must get explicit consent first.
 */
export async function vacuumOpencodeDb(path: string, deps: VacuumDeps = {}): Promise<VacuumResult> {
  if (!existsSync(path)) return { status: "refused", reason: `${path} does not exist` }
  const holders = (deps.processesUsing ?? processesUsing)(path)
  if (holders === null) return { status: "refused", reason: "cannot verify that OpenCode is closed on this platform; close OpenCode and run `sqlite3 <db> VACUUM` yourself" }
  if (holders.length > 0) return { status: "refused", reason: `OpenCode (or another process: pid ${holders.join(", ")}) has the database open; close it first` }
  const before = statSync(path).size
  const needed = before * 2.2
  const free = (deps.freeBytes ?? defaultFreeBytes)(dirname(path))
  if (free < needed) return { status: "refused", reason: `not enough free disk space (${Math.round(free / 1_048_576)} MB free, ~${Math.round(needed / 1_048_576)} MB needed for backup + rebuild)` }
  const sqlite = await loadSqlite()
  if (sqlite === null) return { status: "refused", reason: "SQLite is not available in this runtime" }

  const db = new sqlite.Database(path)
  try {
    db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    const stamp = (deps.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-")
    const backupPath = `${path}.bak-${stamp}`
    copyFileSync(path, backupPath)
    db.run("VACUUM")
    db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    return { status: "done", before, after: statSync(path).size, backupPath }
  } finally {
    db.close()
  }
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export function formatReport(report: KnowledgeReport): string {
  const lines = ["Knowledge index report", ""]
  lines.push(report.project
    ? `Project index:  ${report.project.path}\n                ${report.project.documents} chunks from ${report.project.sources} sources, ${mb(report.project.bytes)}`
    : "Project index:  not built yet (open OpenCode in this project)")
  lines.push(report.sessions
    ? `Session index:  ${report.sessions.path}\n                ${report.sessions.documents} chunks from ${report.sessions.sessions} sessions (${report.sessions.pinned} pinned by plans/decisions), ${mb(report.sessions.bytes)}`
    : "Session index:  disabled or not built yet")
  if (report.opencodeDb) {
    const db = report.opencodeDb
    lines.push(
      `OpenCode DB:    ${db.path}`,
      `                ${mb(db.bytes)}, ${db.sessions} sessions; ${mb(db.reclaimableBytes)} is empty space a VACUUM would reclaim`,
      `                ${db.unreferencedOlderThanRetention} sessions are older than the retention window and cited nowhere`,
    )
    if (db.reclaimableBytes > 50 * 1_048_576) lines.push("", "Tip: close OpenCode and run `oh-my-opencode knowledge report --vacuum` to reclaim that space (a backup is made first).")
  }
  return lines.join("\n")
}
