/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { loadSqlite } from "./bun-sqlite-shim"

describe("loadSqlite", () => {
  test("#given the Bun runtime #then it returns bun:sqlite with FTS5 available", async () => {
    // when
    const sqlite = await loadSqlite()

    // then
    expect(sqlite).not.toBeNull()
    const db = new sqlite!.Database(":memory:")
    db.run("CREATE VIRTUAL TABLE t USING fts5(body)")
    db.run("INSERT INTO t VALUES ('worktrees keep work isolated')")
    expect(db.query("SELECT count(*) AS n FROM t WHERE t MATCH 'worktrees'").get()).toEqual({ n: 1 })
    db.close()
  })

  test("returns the same module on repeated calls", async () => {
    // then
    expect(await loadSqlite()).toBe(await loadSqlite())
  })
})
