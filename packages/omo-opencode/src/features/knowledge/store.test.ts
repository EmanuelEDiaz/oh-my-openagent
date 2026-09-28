/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openKnowledgeStore } from "./store"
import type { KnowledgeStore } from "./store"
import type { KnowledgeDocument } from "./types"

function doc(overrides: Partial<KnowledgeDocument> & Pick<KnowledgeDocument, "body">): KnowledgeDocument {
  return { kind: "plan", source: "plans/a.md", locator: "plans/a.md:1", title: "A", updatedAt: 1, ...overrides }
}

describe("knowledge store", () => {
  let dir: string
  let store: KnowledgeStore | undefined

  afterEach(() => {
    store?.close()
    store = undefined
    rmSync(dir, { recursive: true, force: true })
  })

  async function open(): Promise<KnowledgeStore> {
    dir = mkdtempSync(join(tmpdir(), "omo-knowledge-"))
    const opened = await openKnowledgeStore(join(dir, "knowledge.db"))
    if (opened === null) throw new Error("sqlite unavailable")
    store = opened
    return opened
  }

  test("#given documents #then search returns the best match with its citable locator and a snippet", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("plans/cache.md", "h1", [
      doc({ source: "plans/cache.md", locator: "plans/cache.md:40", title: "Cache", body: "Usamos Redis por la latencia de lectura." }),
      doc({ source: "plans/cache.md", locator: "plans/cache.md:80", title: "Cache", body: "El TTL es de cinco minutos." }),
    ])

    // when
    const hits = knowledge.search("redis latencia")

    // then
    expect(hits[0]?.locator).toBe("plans/cache.md:40")
    expect(hits[0]?.snippet).toContain("«Redis»")
  })

  test("#given a query with FTS5 syntax characters #then it does not throw", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("CHANGELOG.md", "h", [doc({ source: "CHANGELOG.md", body: "Added planning-log evidence and C++ notes" })])

    // then
    expect(knowledge.search("planning-log").length).toBe(1)
    expect(() => knowledge.search('C++ "unbalanced (')).not.toThrow()
  })

  test("#given terms that never co-occur #then it falls back to matching any term", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("plans/a.md", "h", [doc({ body: "worktrees keep changes isolated" })])

    // then
    expect(knowledge.search("worktrees kubernetes").length).toBe(1)
  })

  test("#given kinds with equal text #then decisions outrank tool metadata", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("t", "h", [doc({ kind: "tool", source: "t", locator: "tool-loc", body: "edit src/cache.ts redis" })])
    knowledge.replaceSource("d", "h", [doc({ kind: "decision", source: "d", locator: "decision-loc", body: "edit src/cache.ts redis" })])

    // then
    expect(knowledge.search("redis cache").map((hit) => hit.locator)).toEqual(["decision-loc", "tool-loc"])
  })

  test("#given a source is replaced or removed #then old rows disappear and the hash is tracked", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("plans/a.md", "v1", [doc({ body: "old text about queues" })])

    // when
    knowledge.replaceSource("plans/a.md", "v2", [doc({ body: "new text about streams" })])

    // then
    expect(knowledge.search("queues")).toEqual([])
    expect(knowledge.search("streams").length).toBe(1)
    expect(knowledge.sourceHash("plans/a.md")).toBe("v2")
    knowledge.removeSource("plans/a.md")
    expect(knowledge.search("streams")).toEqual([])
    expect(knowledge.sourceHash("plans/a.md")).toBeUndefined()
  })

  test("#given kinds filter #then only those kinds are returned", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("a", "h", [doc({ kind: "commit", source: "a", locator: "commit:abc", body: "fix redis" })])
    knowledge.replaceSource("b", "h", [doc({ kind: "plan", source: "b", locator: "b:1", body: "redis plan" })])

    // then
    expect(knowledge.search("redis", { kinds: ["commit"] }).map((hit) => hit.locator)).toEqual(["commit:abc"])
  })

  test("#given writes #then maintenance checkpoints the WAL so it does not keep growing", async () => {
    // given
    const knowledge = await open()
    knowledge.replaceSource("big", "h", Array.from({ length: 300 }, (_, index) => doc({ source: "big", locator: `big:${index}`, body: `document number ${index} `.repeat(40) })))

    // when
    knowledge.maintain({ now: Date.now(), force: true })

    // then
    const wal = join(dir, "knowledge.db-wal")
    expect(statSync(wal, { throwIfNoEntry: false })?.size ?? 0).toBe(0)
  })
})
