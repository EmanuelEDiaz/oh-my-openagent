/// <reference types="bun-types" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { evaluatePlanEdit, formatGateMessage, newlyCheckedViolations } from "./evidence-gate"

let project: string
let sha = ""

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omo-evidence-gate-"))
  mkdirSync(join(project, "src"))
  mkdirSync(join(project, "plans"))
  mkdirSync(join(project, ".omo", "evidence", "qa"), { recursive: true })
  writeFileSync(join(project, "src", "cache.ts"), "a\nb\nc\n")
  writeFileSync(join(project, ".omo", "evidence", "qa", "summary.md"), "passed\n")
  writeFileSync(join(project, "plans", "cache.md"), "# Cache\n- [x] 0. Already done\n- [ ] 1. Cache con Valkey\n- [ ] 2. Tests\n")
  const git = (args: string[]) => execFileSync("git", ["-c", "user.email=qa@x", "-c", "user.name=qa", ...args], { cwd: project, stdio: "pipe" }).toString().trim()
  git(["init", "-q"])
  git(["add", "."])
  git(["commit", "-q", "-m", "init"])
  sha = git(["rev-parse", "--short=9", "HEAD"])
})

afterAll(() => rmSync(project, { recursive: true, force: true }))

const context = () => ({ projectDir: project })

describe("newlyCheckedViolations", () => {
  test("a newly checked box without evidence is a violation; already-checked ones are not re-judged", () => {
    // when
    const violations = newlyCheckedViolations("- [x] 0. Already done\n- [ ] 1. Task", "- [x] 0. Already done\n- [x] 1. Task", context())

    // then
    expect(violations).toEqual([{ label: "1. Task", reason: expect.stringContaining("no verifiable evidence") }])
  })

  test("valid evidence on the line or indented below passes; invented evidence fails with the reason", () => {
    // then
    expect(newlyCheckedViolations("- [ ] 1. Task", "- [x] 1. Task — evidence: `src/cache.ts:2`", context())).toEqual([])
    expect(newlyCheckedViolations("- [ ] 1. Task", `- [x] 1. Task\n  - proof: commit:${sha}`, context())).toEqual([])
    expect(newlyCheckedViolations("- [ ] 1. Task", "- [x] 1. Task\n  - evidence: .omo/evidence/qa/summary.md", context())).toEqual([])
    expect(newlyCheckedViolations("- [ ] 1. Task", "- [x] 1. Task — evidence: `src/cache.ts:500`", context())).toEqual([
      { label: "1. Task", reason: "invalid evidence: src/cache.ts:500 (line range out of bounds (the file has 3 lines))" },
    ])
  })
})

describe("evaluatePlanEdit", () => {
  test("computes the result of an edit on a plan file and reports new unchecked-to-checked boxes", () => {
    // when
    const evaluation = evaluatePlanEdit("edit", { filePath: join(project, "plans", "cache.md"), oldString: "- [ ] 1. Cache con Valkey", newString: "- [x] 1. Cache con Valkey" }, context())

    // then
    expect(evaluation?.planPath).toBe("plans/cache.md")
    expect(evaluation?.violations).toHaveLength(1)
    expect(formatGateMessage(evaluation!, "block")).toContain("[evidence-gate] Not saved: plans/cache.md")
  })

  test("ignores non-plan files and edits it cannot compute", () => {
    // then
    expect(evaluatePlanEdit("edit", { filePath: join(project, "src", "cache.ts"), oldString: "a", newString: "- [x] x" }, context())).toBeUndefined()
    expect(evaluatePlanEdit("edit", { filePath: join(project, "plans", "cache.md"), oldString: "not present", newString: "- [x] x" }, context())).toBeUndefined()
    expect(evaluatePlanEdit("write", { filePath: join(project, "plans", "cache.md"), content: "- [x] 0. Already done\n- [ ] 1. Cache con Valkey\n" }, context())?.violations).toEqual([])
  })
})
