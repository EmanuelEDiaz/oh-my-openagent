/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { addPlanToDecision, decisionDirectoryFor, decisionPaths, loadDecisions, parseDecision } from "./decision-files"

const VALID = `---
id: D-20260928-1
title: "Use Valkey"
status: active
date: 2026-09-28
reversibility: easy
area: cache
evidence:
  - type: file
    ref: "src/cache.ts:2-3"
    fingerprint: abc
    note: "backend"
---
# D-20260928-1: Use Valkey
`

describe("decision files", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-decision-files-"))
    mkdirSync(join(project, "docs", "decisions", "2027"), { recursive: true })
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  test("parses the frontmatter the plugin writes", () => {
    // then
    expect(parseDecision("d.md", VALID)).toEqual({
      path: "d.md", id: "D-20260928-1", title: "Use Valkey", status: "active", date: "2026-09-28", reversibility: "easy",
      area: "cache", plans: [], evidence: [{ type: "file", ref: "src/cache.ts:2-3", fingerprint: "abc", note: "backend" }],
    })
  })

  test("reports malformed records instead of accepting them", () => {
    // then
    expect(parseDecision("a.md", "# no frontmatter")).toEqual({ path: "a.md", problems: ["missing frontmatter (--- … ---)"] })
    expect(parseDecision("b.md", "---\nid: D-1\ntitle: x\nstatus: maybe\ndate: 2026\nreversibility: easy\nevidence:\n---\n")).toMatchObject({
      problems: ["evidence list is empty", "unknown status \"maybe\""],
    })
  })

  test("finds records flat and in year folders, and switches to year folders past the threshold", () => {
    // given
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-a.md"), VALID)
    writeFileSync(join(project, "docs", "decisions", "2027", "D-20270101-1-b.md"), VALID.replace("D-20260928-1", "D-20270101-1"))
    writeFileSync(join(project, "docs", "decisions", "D-20260928-2-broken.md"), "broken")

    // then
    expect(decisionPaths(project)).toEqual(["docs/decisions/2027/D-20270101-1-b.md", "docs/decisions/D-20260928-1-a.md", "docs/decisions/D-20260928-2-broken.md"])
    const { valid, invalid } = loadDecisions(project)
    expect(valid.map((record) => record.id).sort()).toEqual(["D-20260928-1", "D-20270101-1"])
    expect(invalid.map((record) => record.path)).toEqual(["docs/decisions/D-20260928-2-broken.md"])
    expect(decisionDirectoryFor(project, "2026")).toBe("docs/decisions")
    for (let index = 0; index < 200; index++) writeFileSync(join(project, "docs", "decisions", `D-20260101-${index + 10}-x.md`), VALID)
    expect(decisionDirectoryFor(project, "2026")).toBe("docs/decisions/2026")
  })

  test("adds a plan reference once", () => {
    // given
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-a.md"), VALID)

    // when
    addPlanToDecision(project, "docs/decisions/D-20260928-1-a.md", "plans/cache.md")
    addPlanToDecision(project, "docs/decisions/D-20260928-1-a.md", "plans/cache.md")

    // then
    const parsed = parseDecision("x", readFileSync(join(project, "docs", "decisions", "D-20260928-1-a.md"), "utf-8"))
    expect(parsed).toMatchObject({ plans: ["plans/cache.md"] })
  })
})
