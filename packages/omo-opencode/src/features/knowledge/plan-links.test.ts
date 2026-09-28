/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { BLOCK_END, BLOCK_START, refreshPlanLinks, upsertPlanBlock } from "./plan-links"

function decision(id: string, extra = ""): string {
  return `---\nid: ${id}\ntitle: "Title ${id}"\nstatus: active\ndate: 2026-09-28\nreversibility: easy\n${extra}evidence:\n  - type: url\n    ref: "https://example.com"\n---\n# ${id}\n`
}

describe("plan decision links", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-plan-links-"))
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    mkdirSync(join(project, "plans"))
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  test("replaces only the text between markers, keeping hand-written notes around it", () => {
    // given
    const plan = `# Plan\nnotes before\n\n## Decisions log\n\n${BLOCK_START}\n- old line\n${BLOCK_END}\n\nmanual note after\n`

    // when
    const updated = upsertPlanBlock(plan, `${BLOCK_START}\n- new line\n${BLOCK_END}`)

    // then
    expect(updated).toBe(`# Plan\nnotes before\n\n## Decisions log\n\n${BLOCK_START}\n- new line\n${BLOCK_END}\n\nmanual note after\n`)
  })

  test("migrates 1.4 full copies into links, keeps manual entries, and reflects supersession", () => {
    // given
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-a.md"), decision("D-20260928-1").replace("status: active", "status: superseded\nsuperseded_by: D-20260928-2"))
    writeFileSync(join(project, "docs", "decisions", "D-20260928-2-b.md"), decision("D-20260928-2", "plans:\n  - \"plans/cache.md\"\n"))
    writeFileSync(join(project, "plans", "cache.md"), [
      "# Cache", "", "## Decisions log", "", "### D1: manual decision", "- **Decision:** keep", "",
      "### D-20260928-1: Title D-20260928-1", "- **Context:** long copy", "- **Record:** `docs/decisions/D-20260928-1-a.md`", "",
      "## Blockers / open questions", "- none", "",
    ].join("\n"))

    // when
    const rewritten = refreshPlanLinks(project)

    // then
    const plan = readFileSync(join(project, "plans", "cache.md"), "utf-8")
    expect(rewritten).toEqual(["plans/cache.md"])
    expect(plan).not.toContain("long copy")
    expect(plan).toContain("### D1: manual decision")
    expect(plan).toContain("- ~~D-20260928-1 — Title D-20260928-1~~ · superseded by D-20260928-2")
    expect(plan).toContain("- D-20260928-2 — Title D-20260928-2 · active · easy")
    expect(plan.indexOf(BLOCK_END)).toBeLessThan(plan.indexOf("## Blockers"))
    expect(refreshPlanLinks(project)).toEqual([])
  })
})
