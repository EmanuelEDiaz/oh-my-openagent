import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { readBoulderState, getBoulderWorks } from "./read-state"
import { createBoulderState, pauseBoulderWork, selectActiveWork, writeBoulderState } from "./write-state"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe("pausing a work for lossless resume (fork 0.8c)", () => {
  test("marks it paused with the reason and resume id; selecting it again makes it active", () => {
    dir = mkdtempSync(join(tmpdir(), "boulder-pause-"))
    const state = createBoulderState(join(dir, "plan.md"), "ses_1")
    writeBoulderState(dir, state)
    const workId = state.active_work_id!

    pauseBoulderWork(dir, workId, { reason: "the model stalled 3 times", resumeId: "run1" })
    const paused = getBoulderWorks(readBoulderState(dir)!).find((work) => work.work_id === workId)!
    expect(paused.status).toBe("paused")
    expect(paused.pause_reason).toBe("the model stalled 3 times")
    expect(paused.resume_id).toBe("run1")

    selectActiveWork(dir, workId)
    const resumed = getBoulderWorks(readBoulderState(dir)!).find((work) => work.work_id === workId)!
    expect(resumed.status).toBe("active")
    expect(resumed.pause_reason).toBeUndefined()
  })

  test("an unknown work is a no-op", () => {
    dir = mkdtempSync(join(tmpdir(), "boulder-pause-"))
    expect(pauseBoulderWork(dir, "nope", { reason: "x" })).toBeNull()
  })
})
