/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkCitations, scanCitations } from "./citation-scan"

describe("scanCitations", () => {
  test("finds file lines, commits and chat locators, ignoring ambiguous shapes", () => {
    // given
    const text = [
      "The bug is in src/cache.ts:12-20 and packages/a/b.test.ts#L5.",
      "Fixed in commit 9b8f63f8e; see ses_Abc1234567/msg_1/prt_2.",
      "Not citations: cache.ts:2, e.g. this, https://example.com/a/b.html, 12:30, ratio 3.14",
    ].join("\n")

    // then
    expect(scanCitations(text)).toEqual([
      { type: "file", ref: "src/cache.ts:12-20" },
      { type: "file", ref: "packages/a/b.test.ts:5" },
      { type: "commit", ref: "9b8f63f8e" },
      { type: "session", ref: "ses_Abc1234567/msg_1/prt_2" },
    ])
  })

  test("multi-dot files with a line number are one citation, never a truncated plain path (live QA bug)", () => {
    // then
    expect(scanCitations("evidence: tests/cache.test.ts:2 and src/app.config.js#L4", { includePlainFiles: true })).toEqual([
      { type: "file", ref: "tests/cache.test.ts:2" },
      { type: "file", ref: "src/app.config.js:4" },
    ])
    expect(scanCitations("see docs/guide.md.", { includePlainFiles: true })).toEqual([{ type: "file", ref: "docs/guide.md" }])
  })

  test("optionally accepts plain file paths (evidence files on disk)", () => {
    // then
    expect(scanCitations("evidence: `.omo/evidence/x/summary.md` and tests/cache.test.ts", { includePlainFiles: true })).toEqual([
      { type: "file", ref: ".omo/evidence/x/summary.md" },
      { type: "file", ref: "tests/cache.test.ts" },
    ])
  })
})

describe("checkCitations", () => {
  let project: string

  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), "omo-citation-scan-"))
    mkdirSync(join(project, "src"))
    writeFileSync(join(project, "src", "cache.ts"), "a\nb\nc\n")
    execFileSync("git", ["init", "-q"], { cwd: project })
  })

  afterAll(() => rmSync(project, { recursive: true, force: true }))

  test("marks each citation valid or invalid with the reason", () => {
    // when
    const checks = checkCitations(scanCitations("src/cache.ts:2 and src/cache.ts:500 and src/missing.ts:1"), { projectDir: project })

    // then
    expect(checks).toEqual([
      { ref: "src/cache.ts:2", ok: true },
      { ref: "src/cache.ts:500", ok: false, reason: "line range out of bounds (the file has 3 lines)" },
      { ref: "src/missing.ts:1", ok: false, reason: "file does not exist" },
    ])
  })
})
