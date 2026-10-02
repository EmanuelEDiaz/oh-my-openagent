import { describe, expect, test } from "bun:test"

import { pendingRuns } from "./resume"
import type { RunResult } from "./types"

const done = (taskId: string, repeat: number, attempt: number, pass: boolean | undefined): RunResult => ({
  taskId, repeat, attempt, grades: [], ...(pass === undefined ? { failure: "infra" as const } : { pass }),
})

describe("pendingRuns", () => {
  test("skips scored repeats and repeats whose infrastructure retries are exhausted", () => {
    const previous = [
      done("a", 0, 0, true),
      done("a", 1, 0, undefined), done("a", 1, 1, undefined), done("a", 1, 2, undefined),
      done("a", 2, 0, undefined),
    ]
    expect(pendingRuns(previous, ["a", "b"], 3, 2)).toEqual([
      { taskId: "a", repeat: 2, nextAttempt: 1 },
      { taskId: "b", repeat: 0, nextAttempt: 0 },
      { taskId: "b", repeat: 1, nextAttempt: 0 },
      { taskId: "b", repeat: 2, nextAttempt: 0 },
    ])
  })
})
