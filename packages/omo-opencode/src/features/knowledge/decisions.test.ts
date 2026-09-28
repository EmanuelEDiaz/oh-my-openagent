/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { decisionStatus, recordDecision, slugify } from "./decisions"
import type { DecisionInput } from "./decisions"

const NOW = new Date("2026-09-28T10:00:00Z")

describe("recordDecision", () => {
  let project: string

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), "omo-decisions-"))
    mkdirSync(join(project, "src"))
    mkdirSync(join(project, "plans"))
    writeFileSync(join(project, "src", "cache.ts"), "export const cache = 'valkey'\nexport const ttl = 300\n")
    writeFileSync(join(project, "plans", "cache.md"), "# Cache\n\n## Decisions log\n\n### D1: old\n- **Decision:** x\n\n## Blockers / open questions\n- none\n")
  })

  afterEach(() => rmSync(project, { recursive: true, force: true }))

  function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
    return {
      title: "Usar Valkey para la caché",
      context: "Necesitamos una caché compatible con Redis sin problemas de licencia.",
      options: ["Redis — licencia", "Valkey — compatible y abierto"],
      decision: "Valkey",
      reason: "Misma API, licencia BSD.",
      reversibility: "costly",
      evidence: [{ type: "file", ref: "src/cache.ts:1", note: "config actual" }],
      ...overrides,
    }
  }

  const context = () => ({ projectDir: project, sessionReader: null })

  test("writes docs/decisions/D-<date>-<n>-<slug>.md in the planning-log format with verified, fingerprinted evidence", () => {
    // when
    const result = recordDecision(input(), { sessionId: "ses_Abc00001", messageId: "msg_1", agent: "sisyphus" }, context(), NOW)

    // then
    if (!result.ok) throw new Error(result.problems.join("\n"))
    expect(result.path).toBe("docs/decisions/D-20260928-1-usar-valkey-para-la-cache.md")
    const content = readFileSync(join(project, result.path), "utf-8")
    expect(content).toContain("status: active")
    expect(content).toMatch(/fingerprint: [0-9a-f]{40}/)
    expect(content).toContain("- **Options considered:**\n  - Redis — licencia\n  - Valkey — compatible y abierto")
    expect(content).toContain("- **Evidence session:** `ses_Abc00001 → msg_1`")
    expect(content).toContain("  - `src/cache.ts:1` — config actual")
  })

  test("rejects decisions without evidence or with invented citations, writing nothing", () => {
    // when
    const noEvidence = recordDecision(input({ evidence: [] }), {}, context(), NOW)
    const invented = recordDecision(input({ evidence: [{ type: "file", ref: "src/cache.ts:99" }, { type: "commit", ref: "deadbeef" }] }), {}, context(), NOW)

    // then
    expect(noEvidence.ok).toBe(false)
    expect(invented).toEqual({ ok: false, problems: [
      "evidence file \"src/cache.ts:99\": line range out of bounds (the file has 2 lines)",
      "evidence commit \"commit:deadbeef\": commit not found in this repository",
    ] })
    expect(existsSync(join(project, "docs", "decisions"))).toBe(false)
  })

  test("numbers decisions per day and supersedes the previous one in both files", () => {
    // given
    const first = recordDecision(input(), {}, context(), NOW)
    if (!first.ok) throw new Error("first failed")

    // when
    const second = recordDecision(input({ title: "Volver a Redis", supersedes: first.id }), {}, context(), NOW)

    // then
    if (!second.ok) throw new Error(second.problems.join("\n"))
    expect(second.id).toBe("D-20260928-2")
    expect(decisionStatus(project, first.path)).toBe("superseded")
    expect(readFileSync(join(project, first.path), "utf-8")).toContain("superseded_by: D-20260928-2")
    expect(second.notes).toContain("D-20260928-1 is now marked superseded by D-20260928-2.")
  })

  test("appends the entry at the end of the plan's Decisions log, before the next section", () => {
    // when
    const result = recordDecision(input({ planPath: "plans/cache.md" }), { sessionId: "ses_Abc00001" }, context(), NOW)

    // then
    if (!result.ok) throw new Error(result.problems.join("\n"))
    const plan = readFileSync(join(project, "plans", "cache.md"), "utf-8")
    expect(plan.indexOf("### D-20260928-1: Usar Valkey")).toBeGreaterThan(plan.indexOf("### D1: old"))
    expect(plan.indexOf("### D-20260928-1: Usar Valkey")).toBeLessThan(plan.indexOf("## Blockers / open questions"))
    expect(plan).toContain("- **Record:** `docs/decisions/D-20260928-1-usar-valkey-para-la-cache.md`")
  })

  test("hard-to-reverse decisions are flagged as ADR candidates; bad plan paths are rejected", () => {
    // then
    const hard = recordDecision(input({ reversibility: "hard" }), {}, context(), NOW)
    expect(hard.ok && hard.notes[0]).toContain("ADR candidate")
    expect(recordDecision(input({ planPath: "../outside.md" }), {}, context(), NOW)).toMatchObject({ ok: false })
  })
})

describe("slugify", () => {
  test("never leaves a trailing hyphen after truncating long titles", () => {
    // then
    expect(slugify("Keep one Markdown file per decision; plans link to decisions instead of copying them")).toBe("keep-one-markdown-file-per-decision-plans-link-to")
    expect(slugify("¿Usar Valkey?")).toBe("usar-valkey")
  })
})
