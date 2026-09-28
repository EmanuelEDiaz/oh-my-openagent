/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { KnowledgeService } from "../../features/knowledge/service"
import type { KnowledgeHit } from "../../features/knowledge/types"
import { createDecisionTools } from "./tools"

describe("decision tools", () => {
  let project: string
  const scheduled: string[] = []

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-decision-tools-"))
    mkdirSync(join(project, "src"))
    mkdirSync(join(project, "docs", "decisions"), { recursive: true })
    writeFileSync(join(project, "src", "a.ts"), "export const a = 1\n")
    writeFileSync(join(project, "docs", "decisions", "D-20260101-1-old.md"), "---\nid: D-20260101-1\nstatus: superseded\n---\n# old redis\n")
    writeFileSync(join(project, "docs", "decisions", "D-20260102-1-new.md"), "---\nid: D-20260102-1\nstatus: active\n---\n# new valkey\n")
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  function tools(hits: KnowledgeHit[] = []) {
    const service: KnowledgeService = {
      scheduleSync: (reason) => scheduled.push(reason),
      syncNow: async () => undefined,
      search: async () => hits,
      open: async () => "",
      close: () => undefined,
    }
    return createDecisionTools(service)
  }

  const context = () => ({ sessionID: "ses_Tool00001", messageID: "msg_1", agent: "sisyphus", directory: project, worktree: project } as never)

  test("decision_record writes the record, reindexes, and reminds to commit it", async () => {
    // when
    const output = await tools().decision_record!.execute({
      title: "Keep a", context: "c", options: ["a", "b"], decision: "a", reason: "r", reversibility: "easy",
      evidence: [{ type: "file", ref: "src/a.ts:1" }],
    }, context())

    // then
    expect(output).toContain("Recorded D-")
    expect(output).toContain("Commit it with the change it explains.")
    expect(scheduled).toContain("decision_record")
  })

  test("decision_record explains every invalid citation instead of writing", async () => {
    // when
    const output = await tools().decision_record!.execute({
      title: "Bad", context: "c", options: ["a"], decision: "a", reason: "r", reversibility: "easy",
      evidence: [{ type: "file", ref: "src/a.ts:40" }],
    }, context())

    // then
    expect(output).toContain("Decision NOT recorded")
    expect(output).toContain("line range out of bounds (the file has 1 lines)")
  })

  test("decision_search hides superseded decisions unless asked", async () => {
    // given
    const hits: KnowledgeHit[] = [
      { kind: "decision", locator: "docs/decisions/D-20260101-1-old.md:5", title: "old", snippet: "redis", updatedAt: 1, score: 2 },
      { kind: "decision", locator: "docs/decisions/D-20260102-1-new.md:5", title: "new", snippet: "valkey", updatedAt: 1, score: 1 },
    ]

    // when
    const active = await tools(hits).decision_search!.execute({ query: "cache" }, context())
    const all = await tools(hits).decision_search!.execute({ query: "cache", include_superseded: true }, context())

    // then
    expect(active).toContain("new [active]")
    expect(active).not.toContain("old [superseded]")
    expect(all).toContain("old [superseded]")
  })
})
