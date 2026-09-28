/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createEvidenceGateHook } from "./index"

describe("evidence-gate hook", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-evidence-gate-hook-"))
    mkdirSync(join(project, "plans"))
    mkdirSync(join(project, "src"))
    writeFileSync(join(project, "src", "cache.ts"), "a\nb\n")
    writeFileSync(join(project, "plans", "p.md"), "- [ ] 1. Cache\n")
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  const check = (newString: string) => ({ args: { filePath: join(project, "plans", "p.md"), oldString: "- [ ] 1. Cache", newString } })

  test("block mode (default) rejects a checkbox marked done without evidence and allows it with evidence", () => {
    // given
    const hook = createEvidenceGateHook({ directory: project })

    // then
    expect(() => hook["tool.execute.before"]({ tool: "edit", callID: "c1" }, check("- [x] 1. Cache"))).toThrow("[evidence-gate] Not saved: plans/p.md")
    expect(() => hook["tool.execute.before"]({ tool: "edit", callID: "c2" }, check("- [x] 1. Cache — evidence: `src/cache.ts:2`"))).not.toThrow()
  })

  test("warn mode lets the edit through and appends the warning to the result", () => {
    // given
    const hook = createEvidenceGateHook({ directory: project }, { evidence_gate: "warn" } as never)
    const result = { output: "Edit applied." }

    // when
    hook["tool.execute.before"]({ tool: "edit", callID: "c3" }, check("- [x] 1. Cache"))
    hook["tool.execute.after"]({ callID: "c3" }, result)

    // then
    expect(result.output).toContain("[evidence-gate] Warning: plans/p.md")
  })
})
