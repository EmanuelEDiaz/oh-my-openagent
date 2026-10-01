import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { answerMatches, citationsExist, outcome } from "./graders"
import { regradeResult } from "./regrade"
import type { RunResult, Task } from "./types"

const fixture = mkdtempSync(join(tmpdir(), "bench-regrade-"))
writeFileSync(join(fixture, "a.ts"), "one\ntwo\n")
afterAll(() => rmSync(fixture, { recursive: true, force: true }))

const task: Task = {
  id: "explore/x",
  agent: "explore",
  mode: "subtask",
  fixture: "unused",
  prompt: "p",
  expect: [citationsExist(), answerMatches([/two/]), outcome("kept", () => false)],
  split: "dev",
  budget: { timeoutMs: 1 },
}

function result(answer: string): RunResult {
  return {
    taskId: "explore/x",
    repeat: 0,
    attempt: 0,
    pass: false,
    failure: "task",
    workdir: "/tmp/gone-sandbox/work/x",
    grades: [{ name: "citationsExist", pass: false }, { name: "outcome:kept", pass: true }],
    transcript: { agent: "explore", model: "m", answer, tools: [], tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, turns: 1, durationMs: 1, delegatedAgents: [] },
  }
}

describe("regradeResult", () => {
  test("re-runs graders on a fresh fixture copy, mapping the old absolute paths", async () => {
    const regraded = await regradeResult(result("see /tmp/gone-sandbox/work/x/a.ts:2 two"), task, fixture)
    expect(regraded.grades.find((grade) => grade.name === "citationsExist")?.pass).toBe(true)
    expect(regraded.pass).toBe(true)
  })

  test("outcome graders keep their recorded result: the final state is gone", async () => {
    const regraded = await regradeResult(result("a.ts:2 two"), task, fixture)
    expect(regraded.grades.find((grade) => grade.name === "outcome:kept")?.pass).toBe(true)
  })

  test("infrastructure failures stay unscored", async () => {
    const infra: RunResult = { taskId: "explore/x", repeat: 0, attempt: 0, failure: "infra", grades: [], error: "403" }
    expect(await regradeResult(infra, task, fixture)).toEqual(infra)
  })
})
