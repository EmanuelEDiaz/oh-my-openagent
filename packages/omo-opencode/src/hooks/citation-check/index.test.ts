/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCitationCheckHook } from "./index"

describe("citation-check hook", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-citation-check-"))
    mkdirSync(join(project, "src"))
    writeFileSync(join(project, "src", "cache.ts"), "a\nb\nc\n")
    execFileSync("git", ["init", "-q"], { cwd: project })
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  test("appends the citations of a subagent report that do not verify", async () => {
    // given
    const hook = createCitationCheckHook({ directory: project })
    const result = { output: "Found it: the TTL is set in src/cache.ts:2 and the retry loop is in src/cache.ts:120. Fixed in commit deadbeef1." }

    // when
    await hook["tool.execute.after"]({ tool: "task" }, result)

    // then
    expect(result.output).toContain("[citation check] 2 of 3 citations in this report could not be verified")
    expect(result.output).toContain("- src/cache.ts:120: line range out of bounds (the file has 3 lines)")
    expect(result.output).toContain("- commit:deadbeef1: commit not found in this repository")
  })

  test("adds nothing when every citation is valid or when the tool is not a report", async () => {
    // given
    const hook = createCitationCheckHook({ directory: project })
    const valid = { output: "See src/cache.ts:2." }
    const read = { output: "src/cache.ts:900" }

    // when
    await hook["tool.execute.after"]({ tool: "task" }, valid)
    await hook["tool.execute.after"]({ tool: "read" }, read)

    // then
    expect(valid.output).toBe("See src/cache.ts:2.")
    expect(read.output).toBe("src/cache.ts:900")
  })
})
