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
    const service = createKnowledgeService(project, undefined)

    // when
    const hits = await service.search("worktrees tarea")

    // then
    expect(hits?.[0]?.locator).toBe("plans/a.md:1")
    service.close()
  })

  test("later edits are picked up after a scheduled sync", async () => {
    // given
    const service = createKnowledgeService(project, undefined, { debounceMs: 5 })
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
    const service = createKnowledgeService(project, undefined, { openStore: async () => null })

    // then
    expect(await service.search("anything")).toBeNull()
    expect(existsSync(join(project, ".omo", "cache", "knowledge.db"))).toBe(false)
  })
})
