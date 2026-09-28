/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createKnowledgeService, knowledgeStorePath } from "./service"

describe("knowledge service", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-knowledge-service-"))
    mkdirSync(join(project, "plans"))
    writeFileSync(join(project, "plans", "a.md"), "# A\nUsamos worktrees para aislar cada tarea.\n")
  })

  afterEach(() => {
    rmSync(project, { recursive: true, force: true })
  })

  test("the index lives in .omo/cache with a .gitignore so it is never committed", () => {
    // when
    const path = knowledgeStorePath(project)

    // then
    expect(path).toBe(join(project, ".omo", "cache", "knowledge.db"))
    expect(readFileSync(join(project, ".omo", "cache", ".gitignore"), "utf-8")).toBe("*\n")
  })

  test("the first search waits for the initial sync and finds project documents", async () => {
    // given
    const service = createKnowledgeService(project, undefined, { openSessionStore: async () => null })

    // when
    const hits = await service.search("worktrees tarea")

    // then
    expect(hits?.[0]?.locator).toBe("plans/a.md:1")
    service.close()
  })

  test("later edits are picked up after a scheduled sync", async () => {
    // given
    const service = createKnowledgeService(project, undefined, { debounceMs: 5, openSessionStore: async () => null })
    await service.search("worktrees")

    // when
    writeFileSync(join(project, "plans", "b.md"), "# B\nDecidimos usar Valkey.\n")
    service.scheduleSync("tool:write")
    await Bun.sleep(30)
    await service.syncNow()

    // then
    expect((await service.search("valkey"))?.[0]?.locator).toBe("plans/b.md:1")
    service.close()
  })

  test("returns null (feature off) when SQLite is unavailable, without throwing", async () => {
    // given
    const service = createKnowledgeService(project, undefined, { openStore: async () => null, openSessionStore: async () => null })

    // then
    expect(await service.search("anything")).toBeNull()
    expect(existsSync(join(project, ".omo", "cache", "knowledge.db"))).toBe(false)
  })
})

describe("knowledge service plan links", () => {
  test("a decision edited by hand refreshes the linking plan on the next sync", async () => {
    // given
    const project = mkdtempSync(join(tmpdir(), "omo-knowledge-links-"))
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    mkdirSync(join(project, "plans"))
    writeFileSync(join(project, "plans", "p.md"), "# P\n\n## Decisions log\n")
    const record = (status: string) => `---\nid: D-20260928-1\ntitle: "Cache"\nstatus: ${status}\ndate: 2026-09-28\nreversibility: easy\nplans:\n  - "plans/p.md"\nevidence:\n  - type: url\n    ref: "https://example.com"\n---\n`
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-cache.md"), record("active"))
    const service = createKnowledgeService(project, undefined, { openSessionStore: async () => null })

    // when
    await service.syncNow()
    const first = readFileSync(join(project, "plans", "p.md"), "utf-8")
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-cache.md"), record("superseded"))
    await service.syncNow()
    const second = readFileSync(join(project, "plans", "p.md"), "utf-8")

    // then
    expect(first).toContain("- D-20260928-1 — Cache · active · easy")
    expect(second).toContain("- ~~D-20260928-1 — Cache~~ · superseded")
    service.close()
    rmSync(project, { recursive: true, force: true })
  })
})
