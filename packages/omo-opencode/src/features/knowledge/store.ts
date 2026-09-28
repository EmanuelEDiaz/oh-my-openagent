import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs"
import { dirname } from "node:path"

import { loadSqlite } from "../../shared/bun-sqlite-shim"
import type { SqliteDatabase } from "../../shared/bun-sqlite-shim"
import { rankScore, toMatchExpression } from "./query"
import type { KnowledgeDocument, KnowledgeHit, KnowledgeKind } from "./types"

const SCHEMA_VERSION = "1"
const CANDIDATE_POOL = 60
const MAINTENANCE_INTERVAL_MS = 7 * 86_400_000

export type SearchOptions = {
  readonly kinds?: readonly KnowledgeKind[]
  readonly limit?: number
  readonly projectId?: string
  readonly now?: number
}

export type KnowledgeStore = {
  readonly replaceSource: (source: string, hash: string, documents: readonly KnowledgeDocument[]) => void
  readonly removeSource: (source: string) => void
  readonly sourceHash: (source: string) => string | undefined
  readonly listSources: (prefix?: string) => string[]
  readonly search: (query: string, options?: SearchOptions) => KnowledgeHit[]
  readonly getMeta: (key: string) => string | undefined
  readonly setMeta: (key: string, value: string) => void
  readonly maintain: (options: { readonly now: number; readonly force?: boolean }) => void
  readonly stats: () => { readonly documents: number; readonly sources: number; readonly bytes: number }
  readonly close: () => void
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sources (source TEXT PRIMARY KEY, hash TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY, kind TEXT NOT NULL, source TEXT NOT NULL, locator TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL, project_id TEXT)`,
  "CREATE INDEX IF NOT EXISTS documents_source ON documents(source)",
  `CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title, body, content='documents', content_rowid='id', tokenize="unicode61 remove_diacritics 2")`,
  `CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, body) VALUES (new.id, new.title, new.body); END`,
  `CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body); END`,
]

function resetIfSchemaChanged(db: SqliteDatabase): void {
  db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  const current = db.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | null
  if (current?.value === SCHEMA_VERSION) return
  for (const statement of ["DROP TABLE IF EXISTS documents_fts", "DROP TABLE IF EXISTS documents", "DROP TABLE IF EXISTS sources"]) {
    db.run(statement)
  }
  for (const statement of SCHEMA) db.run(statement)
  db.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", [SCHEMA_VERSION])
}

type Row = { kind: KnowledgeKind; locator: string; title: string; snippet: string; updated_at: number; bm25: number }

/** Returns null when SQLite is unavailable (non-Bun host): knowledge features then stay off. */
export async function openKnowledgeStore(path: string): Promise<KnowledgeStore | null> {
  const sqlite = await loadSqlite()
  if (sqlite === null) return null
  mkdirSync(dirname(path), { recursive: true })
  const isNew = !existsSync(path)
  const db = new sqlite.Database(path, { create: true })
  if (isNew) chmodSync(path, 0o600)
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  resetIfSchemaChanged(db)
  for (const statement of SCHEMA) db.run(statement)

  const insert = db.prepare(
    "INSERT INTO documents(kind, source, locator, title, body, updated_at, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  const deleteSource = db.prepare("DELETE FROM documents WHERE source = ?")
  const upsertSource = db.prepare("INSERT OR REPLACE INTO sources(source, hash, updated_at) VALUES (?, ?, ?)")

  const replaceSource = db.transaction((source: string, hash: string, documents: readonly KnowledgeDocument[]) => {
    deleteSource.run(source)
    for (const document of documents) {
      insert.run(document.kind, source, document.locator, document.title, document.body, document.updatedAt, document.projectId ?? null)
    }
    upsertSource.run(source, hash, Date.now())
  })

  const runSearch = (match: string, options: SearchOptions): Row[] => {
    const filters: string[] = []
    const params: (string | number)[] = [match]
    if (options.kinds !== undefined && options.kinds.length > 0) {
      filters.push(`d.kind IN (${options.kinds.map(() => "?").join(", ")})`)
      params.push(...options.kinds)
    }
    if (options.projectId !== undefined) {
      filters.push("(d.project_id IS NULL OR d.project_id = ?)")
      params.push(options.projectId)
    }
    params.push(CANDIDATE_POOL)
    return db.query(`
      SELECT d.kind, d.locator, d.title, d.updated_at,
        snippet(documents_fts, 1, '«', '»', '…', 16) AS snippet,
        bm25(documents_fts, 2.0, 1.0) AS bm25
      FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid
      WHERE documents_fts MATCH ? ${filters.length > 0 ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY bm25 LIMIT ?`).all(...params) as Row[]
  }

  const getMeta = (key: string): string | undefined =>
    (db.query("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | null)?.value

  return {
    replaceSource: (source, hash, documents) => replaceSource(source, hash, documents),
    removeSource: (source) => {
      db.transaction(() => {
        deleteSource.run(source)
        db.run("DELETE FROM sources WHERE source = ?", [source])
      })()
    },
    sourceHash: (source) => (db.query("SELECT hash FROM sources WHERE source = ?").get(source) as { hash: string } | null)?.hash,
    listSources: (prefix) => (db.query("SELECT source FROM sources WHERE source LIKE ? ESCAPE '\\'")
      .all(`${(prefix ?? "").replace(/[\\%_]/g, (char) => `\\${char}`)}%`) as { source: string }[]).map((row) => row.source),
    search: (query, options = {}) => {
      const now = options.now ?? Date.now()
      for (const mode of ["all", "any"] as const) {
        const match = toMatchExpression(query, mode)
        if (match === undefined) return []
        const rows = runSearch(match, options)
        if (rows.length === 0) continue
        return rows
          .map((row) => ({
            kind: row.kind,
            locator: row.locator,
            title: row.title,
            snippet: row.snippet,
            updatedAt: row.updated_at,
            score: rankScore(row.bm25, row.kind, row.updated_at, now),
          }))
          .sort((left, right) => right.score - left.score)
          .slice(0, options.limit ?? 8)
      }
      return []
    },
    getMeta,
    setMeta: (key, value) => db.run("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", [key, value]),
    maintain: ({ now, force }) => {
      const last = Number(getMeta("last_optimize") ?? 0)
      if (force || now - last > MAINTENANCE_INTERVAL_MS) {
        db.run("INSERT INTO documents_fts(documents_fts) VALUES ('optimize')")
        db.run("VACUUM")
        db.run("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_optimize', ?)", [String(now)])
      }
      db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    },
    stats: () => ({
      documents: (db.query("SELECT count(*) AS n FROM documents").get() as { n: number }).n,
      sources: (db.query("SELECT count(*) AS n FROM sources").get() as { n: number }).n,
      bytes: statSync(path).size,
    }),
    close: () => db.close(),
  }
}
