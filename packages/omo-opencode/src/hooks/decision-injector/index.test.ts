/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createDecisionInjectorHook } from "./index"

describe("decision-injector hook", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-decision-injector-"))
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    mkdirSync(join(project, "src"))
    writeFileSync(join(project, "src", "cache.ts"), "export const backend = 'valkey'\n")
    writeFileSync(join(project, "docs", "decisions", "D-20260928-1-valkey.md"), [
      "---", "id: D-20260928-1", "title: \"Use Valkey\"", "status: active", "date: 2026-09-28", "reversibility: costly",
      "evidence:", "  - type: file", "    ref: \"src/cache.ts:1\"", "---", "# D-20260928-1", "", "- **Decision:** Valkey, never Redis", "",
    ].join("\n"))
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  const readOutput = (path: string) => ({ title: path, output: "<file content>", metadata: { filePath: path } })

  test("appends the active decision to a read of the cited file, once per session", () => {
    // given
    const hook = createDecisionInjectorHook({ directory: project })
    const first = readOutput(join(project, "src", "cache.ts"))
    const second = readOutput(join(project, "src", "cache.ts"))

    // when
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1" }, first)
    hook["tool.execute.after"]({ tool: "edit", sessionID: "ses_1" }, second)

    // then
    expect(first.output).toContain("[Decisions for src/cache.ts]")
    expect(first.output).toContain("Decision: Valkey, never Redis")
    expect(second.output).toBe("<file content>")
  })

  test("injects again after the session is compacted, and per session", () => {
    // given
    const hook = createDecisionInjectorHook({ directory: project })
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1" }, readOutput(join(project, "src", "cache.ts")))

    // when
    hook.event({ event: { type: "session.compacted", properties: { sessionID: "ses_1" } } })
    const afterCompaction = readOutput(join(project, "src", "cache.ts"))
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1" }, afterCompaction)
    const otherSession = readOutput(join(project, "src", "cache.ts"))
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_2" }, otherSession)

    // then
    expect(afterCompaction.output).toContain("D-20260928-1")
    expect(otherSession.output).toContain("D-20260928-1")
  })

  test("ignores other tools, files outside the project and the decision records themselves", () => {
    // given
    const hook = createDecisionInjectorHook({ directory: project })
    const grep = readOutput(join(project, "src", "cache.ts"))
    const outside = readOutput("/etc/hostname")
    const record = readOutput(join(project, "docs", "decisions", "D-20260928-1-valkey.md"))

    // when
    hook["tool.execute.after"]({ tool: "grep", sessionID: "ses_1" }, grep)
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1" }, outside)
    hook["tool.execute.after"]({ tool: "read", sessionID: "ses_1" }, record)

    // then
    expect([grep.output, outside.output, record.output]).toEqual(["<file content>", "<file content>", "<file content>"])
  })
})
