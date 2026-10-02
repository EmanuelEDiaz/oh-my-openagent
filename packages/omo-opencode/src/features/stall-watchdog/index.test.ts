import { afterEach, describe, expect, test } from "bun:test"

import { createStallWatchdog, setStallWatchdog, stallBudgetExceeded, stallErrorMessage } from "./index"

afterEach(() => setStallWatchdog(undefined))

describe("stallBudgetExceeded (fork 0.8a)", () => {
  test("allows retries up to the budget, then stops", () => {
    setStallWatchdog(createStallWatchdog({ inactivityMs: 1000, maxStallsPerTask: 2 }))
    const error = stallErrorMessage("ses_x")
    expect(stallBudgetExceeded(error, "task-1")).toBe(false)
    expect(stallBudgetExceeded(error, "task-1")).toBe(false)
    expect(stallBudgetExceeded(error, "task-1")).toBe(true)
  })

  test("other errors and a missing watchdog never count", () => {
    expect(stallBudgetExceeded(stallErrorMessage("s"), "t")).toBe(false)
    setStallWatchdog(createStallWatchdog({ inactivityMs: 1000, maxStallsPerTask: 1 }))
    expect(stallBudgetExceeded("429 Too Many Requests", "t")).toBe(false)
    expect(stallBudgetExceeded("429 Too Many Requests", "t")).toBe(false)
  })
})
