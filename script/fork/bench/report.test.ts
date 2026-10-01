import { describe, expect, test } from "bun:test"

import { renderReport } from "./report"
import type { Summary } from "./score"

const summary: Summary = {
  k: 3,
  passAt1: 2 / 3,
  passHatK: 0.5,
  infraFailures: 1,
  meanTokens: 1234.4,
  meanTurns: 3,
  meanDurationMs: 42_000,
  models: ["opencode/big-pickle"],
  tasks: [
    { taskId: "explore/where-retry", scored: 3, passed: 3, passAt1: 1, passHatK: 1, infraFailures: 0, failedGraders: {} },
    { taskId: "explore/env-readers", scored: 3, passed: 1, passAt1: 1 / 3, passHatK: 0, infraFailures: 1, failedGraders: { citationsExist: 2 } },
  ],
}

const meta = { agent: "explore", date: "2026-10-01", label: "baseline", split: "dev" }

describe("renderReport", () => {
  test("a first report has the history row and the latest run detail", () => {
    const markdown = renderReport(undefined, summary, meta)
    expect(markdown).toContain("# Evaluaciones — explore")
    expect(markdown).toContain("| 2026-10-01 | baseline | dev | opencode/big-pickle | 67 % | 50 % | 1234 | 1 |")
    expect(markdown).toContain("| explore/env-readers | 1/3 | 0 % | 1 | citationsExist ×2 |")
  })

  test("a new run keeps earlier history rows and replaces the detail", () => {
    const first = renderReport(undefined, summary, meta)
    const second = renderReport(first, { ...summary, passAt1: 1, tasks: [] }, { ...meta, date: "2026-10-02", label: "prompt v2" })
    expect(second).toContain("| 2026-10-01 | baseline |")
    expect(second).toContain("| 2026-10-02 | prompt v2 |")
    expect(second).not.toContain("explore/env-readers")
  })

  test("runs with different models than the previous one are flagged", () => {
    const first = renderReport(undefined, summary, meta)
    const second = renderReport(first, { ...summary, models: ["ollama/qwen"] }, { ...meta, label: "other model" })
    expect(second).toContain("modelos distintos")
  })
})
