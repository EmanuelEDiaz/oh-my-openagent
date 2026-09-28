import { loadSqlite } from "../../shared/bun-sqlite-shim"

export type FixturePart =
  | { readonly type: "text"; readonly text: string; readonly synthetic?: boolean }
  | { readonly type: "reasoning"; readonly text: string }
  | { readonly type: "tool"; readonly tool: string; readonly input: Record<string, unknown>; readonly output?: string; readonly error?: string }

export type FixtureMessage = {
  readonly id: string
  readonly role: "user" | "assistant"
  readonly summary?: boolean
  readonly created: number
  readonly parts: readonly (FixturePart & { readonly id: string })[]
}

export type FixtureSession = {
  readonly id: string
  readonly projectId: string
  readonly parentId?: string
  readonly directory: string
  readonly title: string
  readonly updated: number
  readonly messages: readonly FixtureMessage[]
}

/** Minimal copy of OpenCode's opencode.db schema (only the columns the reader uses). */
export async function createOpencodeDbFixture(path: string, sessions: readonly FixtureSession[], projects: readonly { id: string; worktree: string }[]): Promise<void> {
  const sqlite = await loadSqlite()
  if (!sqlite) throw new Error("sqlite unavailable")
  const db = new sqlite.Database(path, { create: true })
  db.run("CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL)")
  db.run("CREATE TABLE project_directory (project_id text NOT NULL, directory text NOT NULL)")
  db.run(`CREATE TABLE session (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, directory text NOT NULL,
    title text NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL)`)
  db.run("CREATE TABLE message (id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL)")
  db.run("CREATE TABLE part (id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL, time_created integer NOT NULL, data text NOT NULL)")
  for (const project of projects) db.run("INSERT INTO project VALUES (?, ?)", [project.id, project.worktree])
  for (const session of sessions) {
    db.run("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)", [
      session.id, session.projectId, session.parentId ?? null, session.directory, session.title, session.updated - 1000, session.updated,
    ])
    for (const message of session.messages) {
      db.run("INSERT INTO message VALUES (?, ?, ?, ?)", [
        message.id, session.id, message.created, JSON.stringify({ role: message.role, ...(message.summary ? { summary: true } : {}) }),
      ])
      message.parts.forEach((part, index) => {
        const data = part.type === "tool"
          ? { type: "tool", tool: part.tool, state: part.error === undefined
            ? { status: "completed", input: part.input, output: part.output ?? "" }
            : { status: "error", input: part.input, error: part.error } }
          : part
        db.run("INSERT INTO part VALUES (?, ?, ?, ?, ?)", [part.id, message.id, session.id, message.created + index, JSON.stringify(data)])
      })
    }
  }
  db.close()
}
