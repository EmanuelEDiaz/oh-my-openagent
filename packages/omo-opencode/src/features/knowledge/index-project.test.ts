/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { chunkMarkdown, kindForPath } from "./index-files"
import { syncProject } from "./sync"
import { openKnowledgeStore } from "./store"
import type { KnowledgeStore } from "./store"

describe("chunkMarkdown", () => {
  test("splits by headings, keeps the 1-based start line and the heading path as title", () => {
    // given
    const markdown = ["# Plan", "intro text", "", "## Cache", "Usamos Redis por la latencia.", "", "## Queue", "Kafka later."].join("\n")

    // when
    const chunks = chunkMarkdown(markdown, "plan.md")

    // then
    expect(chunks.map((chunk) => [chunk.line, chunk.title])).toEqual([[1, "Plan"], [4, "Plan > Cache"], [7, "Plan > Queue"]])
    expect(chunks[1]?.body).toContain("Usamos Redis")
  })

  test("ignores headings inside code fences and splits very long sections by paragraph with their own line", () => {
    // given
    const long = Array.from({ length: 12 }, (_, index) => `paragraph ${index} ${"word ".repeat(80)}`).join("\n\n")
    const markdown = ["# Doc", "```", "# not a heading", "```", "", long].join("\n")

    // when
    const chunks = chunkMarkdown(markdown, "doc.md")

    // then
    expect(chunks.every((chunk) => chunk.title === "Doc")).toBe(true)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[1]!.line).toBeGreaterThan(chunks[0]!.line)
  })
})

describe("kindForPath", () => {
  test("classifies project documents", () => {
    // then
    expect(kindForPath("docs/decisions/D-20260927-1-x.md")).toBe("decision")
    expect(kindForPath("docs/adr/0001-x.md")).toBe("adr")
    expect(kindForPath("plans/auth.md")).toBe("plan")
    expect(kindForPath(".omo/plans/auth.md")).toBe("plan")
    expect(kindForPath(".omo/notepads/p/learnings.md")).toBe("notepad")
    expect(kindForPath("packages/x/AGENTS.md")).toBe("agents_md")
    expect(kindForPath("CHANGELOG.md")).toBe("changelog")
    expect(kindForPath("docs/guide.md")).toBe("doc")
  })
})

describe("syncProject", () => {
  let project: string
  let store: KnowledgeStore

  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=qa@example.com", "-c", "user.name=qa", ...args], { cwd: project, stdio: "pipe" })

  beforeEach(async () => {
    project = mkdtempSync(join(tmpdir(), "omo-knowledge-project-"))
    const opened = await openKnowledgeStore(join(project, ".omo", "knowledge.db"))
    if (opened === null) throw new Error("sqlite unavailable")
    store = opened
    git(["init", "-q"])
    writeFileSync(join(project, "AGENTS.md"), "# Rules\nNever push to main.\n")
    mkdirSync(join(project, "plans"))
    writeFileSync(join(project, "plans", "cache.md"), "# Cache\n\n## Why\nUsamos Redis por la latencia.\n")
    git(["add", "."])
    git(["commit", "-q", "-m", "feat: add redis cache layer", "-m", "Chosen for p99 latency."])
  })

  afterEach(() => {
    store.close()
    rmSync(project, { recursive: true, force: true })
  })

  test("indexes documents with line locators and commits with sha locators", async () => {
    // when
    const stats = await syncProject({ store, projectDir: project })

    // then
    expect(stats.filesIndexed).toBe(2)
    expect(store.search("redis latencia", { kinds: ["plan"] })[0]?.locator).toBe("plans/cache.md:3")
    expect(store.search("push main")[0]?.locator).toBe("AGENTS.md:1")
    expect(store.search("p99 latency", { kinds: ["commit"] })[0]?.locator).toMatch(/^commit:[0-9a-f]{12}$/)
  })

  test("is incremental: unchanged files are skipped, edited files reindexed, deleted files removed", async () => {
    // given
    await syncProject({ store, projectDir: project })

    // when
    const unchanged = await syncProject({ store, projectDir: project })
    writeFileSync(join(project, "plans", "cache.md"), "# Cache\n\n## Why\nAhora usamos Valkey.\n")
    const edited = await syncProject({ store, projectDir: project })
    unlinkSync(join(project, "AGENTS.md"))
    await syncProject({ store, projectDir: project })

    // then
    expect(unchanged.filesIndexed).toBe(0)
    expect(edited.filesIndexed).toBe(1)
    expect(store.search("redis", { kinds: ["plan"] })).toEqual([])
    expect(store.search("valkey")[0]?.locator).toBe("plans/cache.md:3")
    expect(store.search("push main")).toEqual([])
  })

  test("works in a directory that is not a git repository", async () => {
    // given
    rmSync(join(project, ".git"), { recursive: true, force: true })

    // when
    const stats = await syncProject({ store, projectDir: project })

    // then
    expect(stats.filesIndexed).toBe(2)
    expect(stats.commitsIndexed).toBe(0)
  })
})
