/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSqlite } from "../../shared/bun-sqlite-shim"
import { createOpencodeDbFixture } from "./session-fixture.test-support"
import type { FixtureSession } from "./session-fixture.test-support"
import { openSessionReader, redactSecrets } from "./session-reader"
import { syncSessions } from "./session-sync"
import { openKnowledgeStore } from "./store"
import type { KnowledgeStore } from "./store"

const DAY = 86_400_000
const NOW = Date.parse("2026-09-28T12:00:00Z")

function session(overrides: Partial<FixtureSession> & Pick<FixtureSession, "id">): FixtureSession {
  return {
    projectId: "proj-a",
    directory: "/work/app",
    title: "Cache work",
    updated: NOW - DAY,
    messages: [
      {
        id: `msg_${overrides.id}_1`, role: "user", created: NOW - DAY,
        parts: [{ id: `prt_${overrides.id}_1`, type: "text", text: "Usa worktrees para cada tarea, nunca en main." }],
      },
      {
        id: `msg_${overrides.id}_2`, role: "assistant", created: NOW - DAY + 10,
        parts: [
          { id: `prt_${overrides.id}_2`, type: "reasoning", text: "maybe we should delete main (wrong idea)" },
          { id: `prt_${overrides.id}_3`, type: "tool", tool: "edit", input: { filePath: "/work/app/src/cache.ts" }, output: "SECRET OUTPUT" },
          { id: `prt_${overrides.id}_4`, type: "text", text: "Entendido: cada tarea en su worktree." },
          { id: `prt_${overrides.id}_5`, type: "text", text: "injected reminder", synthetic: true },
        ],
      },
    ],
    ...overrides,
  }
}

describe("session index", () => {
  let dir: string
  let dbPath: string
  let store: KnowledgeStore

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omo-session-index-"))
    dbPath = join(dir, "opencode.db")
    const opened = await openKnowledgeStore(join(dir, "sessions-index.db"))
    if (!opened) throw new Error("sqlite unavailable")
    store = opened
  })

  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function sync(sessions: FixtureSession[], options: { retentionDays?: number } = {}) {
    rmSync(dbPath, { force: true })
    await createOpencodeDbFixture(dbPath, sessions, [{ id: "proj-a", worktree: "/work/app" }, { id: "global", worktree: "/" }])
    const reader = await openSessionReader(dbPath)
    if (!reader) throw new Error("reader unavailable")
    try {
      return syncSessions({ store, reader, now: NOW, retentionDays: options.retentionDays ?? 180, maxIndexMb: 200 })
    } finally {
      reader.close()
    }
  }

  test("indexes user, assistant and tool metadata with exact ses/msg/prt locators; skips reasoning, synthetic text and tool outputs", async () => {
    // when
    await sync([session({ id: "ses_a" })])

    // then
    const user = store.search("worktrees tarea main", { kinds: ["user"] })
    expect(user[0]?.locator).toBe("ses_a/msg_ses_a_1/prt_ses_a_1")
    expect(store.search("entendido worktree", { kinds: ["assistant"] })[0]?.locator).toBe("ses_a/msg_ses_a_2/prt_ses_a_4")
    expect(store.search("cache.ts", { kinds: ["tool"] })[0]?.locator).toBe("ses_a/msg_ses_a_2/prt_ses_a_3")
    expect(store.search("wrong idea")).toEqual([])
    expect(store.search("injected reminder")).toEqual([])
    expect(store.search("SECRET OUTPUT")).toEqual([])
  })

  test("subagent sessions and compaction summaries get their own kinds", async () => {
    // given
    const child = session({ id: "ses_child", parentId: "ses_a", title: "research" })
    const summarized = session({
      id: "ses_sum",
      messages: [{ id: "msg_sum", role: "assistant", summary: true, created: NOW - DAY, parts: [{ id: "prt_sum", type: "text", text: "Resumen: decidimos Valkey." }] }],
    })

    // when
    await sync([session({ id: "ses_a" }), child, summarized])

    // then
    expect(store.search("worktrees", { kinds: ["subagent"] })[0]?.locator).toStartWith("ses_child/")
    expect(store.search("valkey", { kinds: ["summary"] })[0]?.locator).toBe("ses_sum/msg_sum/prt_sum")
  })

  test("is incremental and removes sessions deleted from OpenCode", async () => {
    // given
    const first = await sync([session({ id: "ses_a" }), session({ id: "ses_b" })])

    // when
    const unchanged = await sync([session({ id: "ses_a" }), session({ id: "ses_b" })])
    const afterDelete = await sync([session({ id: "ses_a" })])

    // then
    expect(first.sessionsIndexed).toBe(2)
    expect(unchanged.sessionsIndexed).toBe(0)
    expect(afterDelete.sessionsRemoved).toBe(1)
    expect(store.search("worktrees").some((hit) => hit.locator.startsWith("ses_b/"))).toBe(false)
  })

  test("unreferenced sessions past retention leave the index; pinned (referenced) ones stay", async () => {
    // given
    const old = (id: string) => session({ id, updated: NOW - 200 * DAY })
    store.setMeta("pinned:ses_pinned", "docs/decisions/D-1.md")

    // when
    const stats = await sync([old("ses_old"), old("ses_pinned"), session({ id: "ses_new" })])

    // then
    const sessions = new Set(store.search("worktrees", { limit: 20 }).map((hit) => hit.locator.split("/")[0]))
    expect(sessions.has("ses_old")).toBe(false)
    expect(sessions.has("ses_pinned")).toBe(true)
    expect(sessions.has("ses_new")).toBe(true)
    expect(stats.sessionsSkippedByRetention).toBe(1)
  })

  test("documents carry the project id; non-git sessions are scoped by directory", async () => {
    // when
    await sync([session({ id: "ses_a" }), session({ id: "ses_g", projectId: "global", directory: "/tmp/scratch" })])

    // then
    expect(store.search("worktrees", { projectId: "proj-a" }).every((hit) => hit.locator.startsWith("ses_a/"))).toBe(true)
    expect(store.search("worktrees", { projectId: "global:/tmp/scratch" }).every((hit) => hit.locator.startsWith("ses_g/"))).toBe(true)
  })

  test("never writes to the OpenCode database", async () => {
    // given
    await createOpencodeDbFixture(dbPath, [session({ id: "ses_a" })], [{ id: "proj-a", worktree: "/work/app" }])
    const before = statSync(dbPath).mtimeMs
    const reader = await openSessionReader(dbPath)

    // when
    await syncSessions({ store, reader: reader!, now: NOW, retentionDays: 180, maxIndexMb: 200 })
    reader!.close()

    // then
    expect(statSync(dbPath).mtimeMs).toBe(before)
  })

  test("an unexpected OpenCode schema disables session indexing instead of failing", async () => {
    // given
    const sqlite = await loadSqlite()
    const db = new sqlite!.Database(dbPath, { create: true })
    db.run("CREATE TABLE session (id text)")
    db.close()

    // then
    expect(await openSessionReader(dbPath)).toBeNull()
  })

  test("resolves the project of a directory by the longest worktree prefix", async () => {
    // given
    await createOpencodeDbFixture(dbPath, [], [{ id: "proj-a", worktree: "/work/app" }, { id: "global", worktree: "/" }])
    const reader = await openSessionReader(dbPath)

    // then
    expect(reader!.projectIdFor("/work/app/packages/api")).toBe("proj-a")
    expect(reader!.projectIdFor("/somewhere/else")).toBe("global:/somewhere/else")
    reader!.close()
  })
})

describe("redactSecrets", () => {
  test("masks API keys, bearer tokens and private keys", () => {
    // when
    const redacted = redactSecrets("key sk-ant-api03-abcdefghijklmnopqrstuv and Authorization: Bearer abc.def.ghijklmnop and ghp_0123456789abcdefghijklmnopqrstuvwxyz AKIAABCDEFGHIJKLMNOP")

    // then
    expect(redacted).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuv")
    expect(redacted).not.toContain("abc.def.ghijklmnop")
    expect(redacted).not.toContain("ghp_0123456789")
    expect(redacted).not.toContain("AKIAABCDEFGHIJKLMNOP")
    expect(redacted).toContain("[REDACTED]")
  })
})
