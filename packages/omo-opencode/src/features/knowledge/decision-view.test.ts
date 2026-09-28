/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { DecisionRecord } from "./decision-files"
import { filterDecisions, formatDecisionView, supersessionChains } from "./decision-view"

function record(id: string, extra: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    path: `docs/decisions/${id}-x.md`, id, title: `Title ${id}`, status: "active", date: "2026-09-28", reversibility: "easy", plans: [],
    evidence: [{ type: "file", ref: "src/cache.ts:2-3" }], ...extra,
  }
}

describe("decision view", () => {
  const records = [
    record("D-20260901-1", { status: "superseded", supersededBy: "D-20260915-1", area: "cache" }),
    record("D-20260915-1", { status: "superseded", supersedes: "D-20260901-1", supersededBy: "D-20260928-1", area: "cache" }),
    record("D-20260928-1", { supersedes: "D-20260915-1", area: "cache" }),
    record("D-20260928-2", { area: "auth", evidence: [{ type: "file", ref: "src/auth/login.ts:10" }] }),
  ]

  test("filters by status (active by default), area and cited file or directory", () => {
    // then
    expect(filterDecisions(records, {}).map((item) => item.id)).toEqual(["D-20260928-1", "D-20260928-2"])
    expect(filterDecisions(records, { status: "all", area: "cache" })).toHaveLength(3)
    expect(filterDecisions(records, { file: "src/auth" }).map((item) => item.id)).toEqual(["D-20260928-2"])
    expect(filterDecisions(records, { file: "./src/cache.ts" }).map((item) => item.id)).toEqual(["D-20260928-1"])
  })

  test("renders the table, the supersession chain and malformed records", () => {
    // when
    const view = formatDecisionView(records, filterDecisions(records, {}), [{ path: "docs/decisions/D-1-bad.md", problems: ["missing \"evidence\""] }])

    // then
    expect(supersessionChains(records)).toEqual(["D-20260901-1 → D-20260915-1 → D-20260928-1"])
    expect(view).toContain("D-20260928-1   2026-09-28  active      easy     cache       Title D-20260928-1")
    expect(view).toContain("  D-20260901-1 → D-20260915-1 → D-20260928-1")
    expect(view).toContain("  docs/decisions/D-1-bad.md: missing \"evidence\"")
    expect(view).toContain("2 shown of 4 valid record(s).")
  })
})
