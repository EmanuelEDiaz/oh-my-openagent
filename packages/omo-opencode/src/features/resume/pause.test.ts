import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createBoulderState, writeBoulderState, getBoulderWorks, readBoulderState } from "@oh-my-opencode/boulder-state"

import { pauseWork, resumeIdFor } from "./pause"
import { loadResume } from "./store"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function git(...args: string[]): void {
  Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } })
}

const snapshot = {
  sessionId: "ses_abc",
  userMessages: [{ locator: "ses_abc/msg_1", text: "Add a login page" }],
  decisions: [{ id: "D-1", title: "Use sessions, not JWT", path: "docs/decisions/D-1.md" }],
  filesChanged: ["src/login.ts"],
  errors: [{ locator: "ses_abc/msg_5", text: "TypeError: x is undefined" }],
}

describe("pauseWork (fork 0.8c)", () => {
  test("writes a card with the requests, plan step, work in progress and what not to repeat; pauses the plan", async () => {
    dir = mkdtempSync(join(tmpdir(), "pause-"))
    git("init", "-q")
    writeFileSync(join(dir, "plan.md"), "## TODOs\n- [x] 1. Scaffold\n- [ ] 2. Login form\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    writeFileSync(join(dir, "login.ts"), "export const wip = 1\n")
    writeBoulderState(dir, createBoulderState(join(dir, "plan.md"), "ses_abc", "atlas"))

    const card = await pauseWork({
      projectDir: dir,
      sessionID: "ses_abc",
      reason: "the model stalled 3 times",
      attempts: [{ model: "opencode/big-pickle", outcome: "stalled (no output 4 min)" }],
      snapshot: () => snapshot,
      target: async () => ({ agent: "Atlas - Plan Executor", model: "opencode/big-pickle" }),
    })

    const saved = loadResume(dir, resumeIdFor("ses_abc"))!
    expect(saved.requests[0]!.text).toBe("Add a login page")
    expect(saved.plan?.progress).toBe("1/2")
    expect(saved.plan?.currentTask).toContain("Login form")
    expect(saved.wip?.diffStat).toContain("login.ts")
    expect(saved.attempts[0]!.outcome).toContain("stalled")
    expect(saved.nextAction).toContain("Login form")
    expect(card.id).toBe(saved.id)
    const work = getBoulderWorks(readBoulderState(dir)!)[0]!
    expect(work.status).toBe("paused")
    expect(work.resume_id).toBe(saved.id)
    expect(readFileSync(join(dir, ".omo/runs", saved.id, "RESUME.md"), "utf8")).toContain("Add a login page")
  })

  test("without a plan or git it still saves a usable card", async () => {
    dir = mkdtempSync(join(tmpdir(), "pause-plain-"))
    const card = await pauseWork({ projectDir: dir, sessionID: "ses_x", reason: "SIGTERM", attempts: [], snapshot: () => undefined, target: async () => ({}) })
    expect(card.plan).toBeUndefined()
    expect(card.wip).toBeUndefined()
    expect(card.nextAction).toContain("last request")
  })
})
