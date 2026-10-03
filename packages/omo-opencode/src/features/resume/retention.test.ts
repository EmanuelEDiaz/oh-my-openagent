import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBoulderState, upsertTaskSessionState, writeBoulderState, completeBoulder, pauseBoulderWork } from "@oh-my-opencode/boulder-state"

import { isSessionRetained, registerRetentionDirectory, unregisterRetentionDirectory } from "./retention"

let dir = ""
afterEach(() => {
  if (dir) { unregisterRetentionDirectory(dir); rmSync(dir, { recursive: true, force: true }) }
})

function seed(): string {
  dir = mkdtempSync(join(tmpdir(), "retention-"))
  const state = createBoulderState(join(dir, "plan.md"), "ses_main", "atlas")
  writeBoulderState(dir, state)
  upsertTaskSessionState(dir, { taskKey: "todo:1", taskLabel: "1", taskTitle: "Login", sessionId: "ses_child", agent: "sisyphus-junior" })
  registerRetentionDirectory(dir)
  return state.active_work_id!
}

describe("subagent sessions of an unfinished plan are kept (fork 0.8c)", () => {
  test("a task session of an active or paused work is retained; others are not", () => {
    const workId = seed()
    expect(isSessionRetained("ses_child")).toBe(true)
    expect(isSessionRetained("ses_main")).toBe(true)
    expect(isSessionRetained("ses_unrelated")).toBe(false)
    pauseBoulderWork(dir, workId, { reason: "x" })
    expect(isSessionRetained("ses_child")).toBe(true)
  })

  test("once the work is completed its sessions can be cleaned up again", () => {
    const workId = seed()
    completeBoulder(dir, workId)
    expect(isSessionRetained("ses_child")).toBe(false)
  })
})
