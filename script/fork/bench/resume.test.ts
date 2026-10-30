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

  test("#given attempts stopped by the provider's quota #then they do not use up the repeat's retries", () => {
    const quota = (attempt: number): RunResult => ({ ...done("a", 0, attempt, undefined), error: "provider usage limit reached: Free usage limit reached." })
    expect(pendingRuns([quota(0), quota(1), quota(2)], ["a"], 1, 2)).toEqual([{ taskId: "a", repeat: 0, nextAttempt: 0 }])
    expect(pendingRuns([done("a", 0, 0, undefined), quota(1)], ["a"], 1, 2)).toEqual([{ taskId: "a", repeat: 0, nextAttempt: 1 }])
  })
})
