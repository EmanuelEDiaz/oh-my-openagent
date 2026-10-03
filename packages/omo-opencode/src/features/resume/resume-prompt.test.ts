import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildResumePrompt } from "./resume-prompt"
import { captureWip, type ResumeCard } from "./store"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function git(...args: string[]): void {
  Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } })
}

describe("resume prompt (fork 0.8c)", () => {
  test("gives the card, the saved diff, the hint and the do-not-repeat rule; warns if files changed since", () => {
    dir = mkdtempSync(join(tmpdir(), "resume-prompt-"))
    git("init", "-q")
    writeFileSync(join(dir, "a.ts"), "export const a = 1\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    writeFileSync(join(dir, "a.ts"), "export const a = 2 // wip\n")
    const wip = captureWip(dir, "run_s")!
    const card: ResumeCard = {
      id: "run_s", createdAt: "2026-10-02T00:00:00.000Z", reason: "SIGTERM (out of memory)", sessionID: "s",
      requests: [{ locator: "s/m1", text: "Change a to 2" }], decisions: [], filesChanged: ["a.ts"], errors: [],
      attempts: [{ model: "opencode/x", outcome: "stalled" }], wip, nextAction: "Run the tests",
    }

    const prompt = buildResumePrompt(dir, card, "use the other model")
    expect(prompt).toContain("Change a to 2")
    expect(prompt).toContain("+export const a = 2 // wip")
    expect(prompt).toContain("still matches")
    expect(prompt).toContain("use the other model")
    expect(prompt).toContain("Do not repeat")

    writeFileSync(join(dir, "a.ts"), "export const a = 3\n")
    expect(buildResumePrompt(dir, card)).toContain("no longer matches")
  })
})
