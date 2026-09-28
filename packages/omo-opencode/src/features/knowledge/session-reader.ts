import { existsSync } from "node:fs"

import { loadSqlite } from "../../shared/bun-sqlite-shim"
import type { SqliteDatabase } from "../../shared/bun-sqlite-shim"

export type SessionRow = {
  readonly id: string
  readonly projectId: string
  readonly parentId: string | null
  readonly directory: string
  readonly title: string
  readonly updated: number
}

export type SessionPart = {
  readonly partId: string
  readonly messageId: string
  readonly created: number
  readonly role: string | null
  readonly summary: boolean
  readonly type: string | null
  readonly text: string | null
  readonly synthetic: boolean
  readonly tool: string | null
  readonly toolInput: string | null
  readonly toolStatus: string | null
  readonly toolError: string | null
}

export type SessionReader = {
  readonly listSessions: () => SessionRow[]
  readonly partsOf: (sessionId: string) => SessionPart[]
  readonly messageIdsOf: (sessionId: string) => string[]
  readonly partsOfMessage: (messageId: string) => SessionPart[]
  readonly session: (sessionId: string) => SessionRow | undefined
  /** Text of the most recent compaction summary message of a session ("" when none). */
  readonly latestSummaryText: (sessionId: string) => string
  /** OpenCode project id for a directory; non-git ("global") directories are scoped by their path. */
  readonly projectIdFor: (directory: string) => string
  readonly close: () => void
}

const REQUIRED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  session: ["id", "project_id", "parent_id", "directory", "title", "time_updated"],
  message: ["id", "session_id", "time_created", "data"],
  part: ["id", "message_id", "session_id", "time_created", "data"],
  project: ["id", "worktree"],
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|secret|token|password)(["']?\s*[:=]\s*["']?)[^\s"']{8,}/gi,
]

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, (match, name?: string, separator?: string) =>
      typeof name === "string" && typeof separator === "string" ? `${name}${separator}[REDACTED]` : "[REDACTED]"),
    text,
  )
}

function hasSchema(db: SqliteDatabase): boolean {
  return Object.entries(REQUIRED_COLUMNS).every(([table, columns]) => {
    const present = new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name))
    return columns.every((column) => present.has(column))
  })
}

const PART_COLUMNS = `p.id AS partId, p.message_id AS messageId, p.time_created AS created,
  json_extract(m.data, '$.role') AS role, json_extract(m.data, '$.summary') AS summary,
  json_extract(p.data, '$.type') AS type, json_extract(p.data, '$.text') AS text,
  json_extract(p.data, '$.synthetic') AS synthetic, json_extract(p.data, '$.tool') AS tool,
  json_extract(p.data, '$.state.input') AS toolInput,
  json_extract(p.data, '$.state.status') AS toolStatus, json_extract(p.data, '$.state.error') AS toolError`

type RawPart = Omit<SessionPart, "summary" | "synthetic"> & { summary: unknown; synthetic: unknown }

function toPart(raw: RawPart): SessionPart {
  return { ...raw, summary: raw.summary === 1 || raw.summary === true, synthetic: raw.synthetic === 1 || raw.synthetic === true }
}

/**
 * Read-only view of OpenCode's session database. Returns null when the file is missing, SQLite is
 * unavailable, or the schema is not the one this reader understands (session indexing then stays off).
 */
export async function openSessionReader(path: string): Promise<SessionReader | null> {
  if (!existsSync(path)) return null
  const sqlite = await loadSqlite()
  if (sqlite === null) return null
  const db = new sqlite.Database(path, { readonly: true })
  if (!hasSchema(db)) {
    db.close()
    return null
  }

  const worktrees = (db.query("SELECT id, worktree AS path FROM project").all() as { id: string; path: string }[])
  const hasProjectDirectory = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_directory'").get() ?? null) !== null
  const directories = hasProjectDirectory
    ? (db.query("SELECT project_id AS id, directory AS path FROM project_directory").all() as { id: string; path: string }[])
    : []
  const roots = [...worktrees, ...directories].filter((root) => root.path !== "/" && root.id !== "global")

  const sessionColumns = "id, project_id AS projectId, parent_id AS parentId, directory, title, time_updated AS updated"
  const scope = (projectId: string, directory: string): string => (projectId === "global" ? `global:${directory}` : projectId)
  const partsBySession = db.prepare(`SELECT ${PART_COLUMNS} FROM part p JOIN message m ON m.id = p.message_id WHERE p.session_id = ? ORDER BY p.time_created, p.id`)
  const partsByMessage = db.prepare(`SELECT ${PART_COLUMNS} FROM part p JOIN message m ON m.id = p.message_id WHERE p.message_id = ? ORDER BY p.time_created, p.id`)

  return {
    listSessions: () => (db.query(`SELECT ${sessionColumns} FROM session`).all() as SessionRow[])
      .map((row) => ({ ...row, projectId: scope(row.projectId, row.directory) })),
    partsOf: (sessionId) => (partsBySession.all(sessionId) as RawPart[]).map(toPart),
    messageIdsOf: (sessionId) => (db.query("SELECT id FROM message WHERE session_id = ? ORDER BY time_created, id").all(sessionId) as { id: string }[]).map((row) => row.id),
    partsOfMessage: (messageId) => (partsByMessage.all(messageId) as RawPart[]).map(toPart),
    session: (sessionId) => {
      const row = db.query(`SELECT ${sessionColumns} FROM session WHERE id = ?`).get(sessionId) as SessionRow | null
      return row === null ? undefined : { ...row, projectId: scope(row.projectId, row.directory) }
    },
    latestSummaryText: (sessionId) => {
      const row = db.query("SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.summary') = 1 ORDER BY time_created DESC, id DESC LIMIT 1").get(sessionId) as { id: string } | null
      if (row === null) return ""
      return (partsByMessage.all(row.id) as RawPart[]).map(toPart).filter((part) => part.type === "text" && part.text).map((part) => part.text).join("\n")
    },
    projectIdFor: (directory) => {
      const match = roots
        .filter((root) => directory === root.path || directory.startsWith(`${root.path.replace(/\/+$/, "")}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]
      return match?.id ?? `global:${directory}`
    },
    close: () => db.close(),
  }
}
