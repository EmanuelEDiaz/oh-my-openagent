/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadSqlite } from "../../shared/bun-sqlite-shim"
import { formatReport, inspectOpencodeDb, processesUsing, vacuumOpencodeDb } from "./report"

const DAY = 86_400_000
const NOW = Date.parse("2026-09-28T12:00:00Z")

describe("opencode.db report and vacuum", () => {
  let dir: string
  let dbPath: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "omo-knowledge-report-"))
    dbPath = join(dir, "opencode.db")
    const sqlite = await loadSqlite()
    const db = new sqlite!.Database(dbPath, { create: true })
    db.run("CREATE TABLE session (id text PRIMARY KEY, time_updated integer NOT NULL)")
    db.run("CREATE TABLE blob (data text)")
    db.run("INSERT INTO session VALUES ('ses_old', ?), ('ses_pinned', ?), ('ses_new', ?)", [NOW - 300 * DAY, NOW - 300 * DAY, NOW - DAY])
    for (let index = 0; index < 400; index++) db.run("INSERT INTO blob VALUES (?)", ["x".repeat(4000)])
    db.run("DELETE FROM blob")
    db.close()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test("reports size, reclaimable free pages and unreferenced old sessions without writing", async () => {
    // given
    const before = statSync(dbPath).mtimeMs

    // when
    const report = await inspectOpencodeDb(dbPath, new Set(["ses_pinned"]), 180, NOW)

    // then
    expect(report?.sessions).toBe(3)
    expect(report?.unreferencedOlderThanRetention).toBe(1)
    expect(report?.reclaimableBytes).toBeGreaterThan(1_000_000)
    expect(statSync(dbPath).mtimeMs).toBe(before)
    expect(formatReport({ project: null, sessions: null, opencodeDb: report })).toContain("a VACUUM would reclaim")
  })

  test.if(process.platform === "linux")("detects a real process holding the database open", async () => {
    // given
    const holder = Bun.spawn(["bash", "-c", `exec 3<"${dbPath}"; sleep 5`])
    await Bun.sleep(300)

    // when
    const holders = processesUsing(dbPath)
    holder.kill()

    // then
    expect(holders).toContain(holder.pid)
  })

  test("refuses to vacuum while another process has the database open", async () => {
    // when
    const result = await vacuumOpencodeDb(dbPath, { processesUsing: () => [4242] })

    // then
    expect(result).toEqual({ status: "refused", reason: expect.stringContaining("pid 4242") })
  })

  test("refuses when there is not enough disk for backup + rebuild", async () => {
    // when
    const result = await vacuumOpencodeDb(dbPath, { processesUsing: () => [], freeBytes: () => 1000 })

    // then
    expect(result.status).toBe("refused")
  })

  test("backs up, then vacuums and shrinks the file, keeping the data", async () => {
    // when
    const result = await vacuumOpencodeDb(dbPath, { processesUsing: () => [], freeBytes: () => Number.MAX_SAFE_INTEGER, now: () => new Date(NOW) })

    // then
    if (result.status !== "done") throw new Error(result.reason)
    expect(result.after).toBeLessThan(result.before)
    expect(existsSync(result.backupPath)).toBe(true)
    expect(statSync(result.backupPath).size).toBe(result.before)
    const report = await inspectOpencodeDb(dbPath, new Set(), 180, NOW)
    expect(report?.sessions).toBe(3)
    expect(report?.reclaimableBytes).toBe(0)
  })
})
