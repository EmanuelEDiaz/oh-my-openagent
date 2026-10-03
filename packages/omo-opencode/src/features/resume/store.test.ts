import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { captureWip, deleteResume, listPaused, loadResume, restoreCheck, saveResume, type ResumeCard } from "./store"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function git(...args: string[]): string {
  const run = Bun.spawnSync(["git", ...args], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" } })
  return run.stdout.toString().trim()
}

function repo(): void {
  dir = mkdtempSync(join(tmpdir(), "resume-"))
  git("init", "-q")
  writeFileSync(join(dir, "a.txt"), "v1\n")
  writeFileSync(join(dir, ".gitignore"), "node_modules\n")
  git("add", "-A")
  git("commit", "-qm", "base")
}

const card = (id: string): ResumeCard => ({
  id, createdAt: "2026-10-02T00:00:00.000Z", reason: "the model stalled 3 times", sessionID: "ses_1", agent: "Sisyphus - ultraworker",
  requests: [{ locator: "ses_1/msg_1", text: "Add login" }], decisions: [], filesChanged: ["a.txt"], errors: [],
  attempts: [{ model: "opencode/big-pickle", outcome: "stalled" }], nextAction: "Continue step 2",
})

describe("lossless resume store (fork 0.8c)", () => {
  test("captures modified and new files in a hidden ref without touching index, files or branch", () => {
    repo()
    writeFileSync(join(dir, "a.txt"), "v2 work in progress\n")
    writeFileSync(join(dir, "new.txt"), "new\n")
    writeFileSync(join(dir, "staged.txt"), "staged\n")
    git("add", "staged.txt")
    const statusBefore = git("status", "--porcelain")

    const wip = captureWip(dir, "run1")

    expect(wip?.ref).toBe("refs/omo/wip/run1")
    expect(git("status", "--porcelain")).toBe(statusBefore)
    expect(git("show", `${wip!.ref}:a.txt`)).toBe("v2 work in progress")
    expect(git("show", `${wip!.ref}:new.txt`)).toBe("new")
    expect(git("branch", "--list")).not.toContain("wip")
    expect(git("log", "--oneline").split("\n")).toHaveLength(1)
    expect(wip!.diffStat).toContain("a.txt")
  })

  test("outside a git repo there is no WIP ref, but the card is still saved", () => {
    dir = mkdtempSync(join(tmpdir(), "resume-nogit-"))
    expect(captureWip(dir, "x")).toBeUndefined()
    saveResume(dir, card("x"))
    expect(loadResume(dir, "x")?.reason).toContain("stalled")
  })

  test("saves card + markdown, lists paused runs and deletes them with their ref", () => {
    repo()
    writeFileSync(join(dir, "a.txt"), "changed\n")
    const wip = captureWip(dir, "run2")
    saveResume(dir, { ...card("run2"), wip })
    const markdown = readFileSync(join(dir, ".omo/runs/run2/RESUME.md"), "utf8")
    expect(markdown).toContain("Add login")
    expect(markdown).toContain("Do not repeat")
    expect(markdown).toContain("refs/omo/wip/run2")
    expect(existsSync(join(dir, ".omo/runs/.gitignore"))).toBe(true)
    expect(listPaused(dir).map((entry) => entry.id)).toEqual(["run2"])
    deleteResume(dir, "run2")
    expect(listPaused(dir)).toEqual([])
    expect(git("show-ref", "refs/omo/wip/run2")).toBe("")
  })

  test("restoreCheck says whether the working tree still matches the saved work", () => {
    repo()
    writeFileSync(join(dir, "a.txt"), "wip\n")
    const wip = captureWip(dir, "run3")!
    expect(restoreCheck(dir, wip).matches).toBe(true)
    writeFileSync(join(dir, "a.txt"), "someone changed it\n")
    const check = restoreCheck(dir, wip)
    expect(check.matches).toBe(false)
    expect(check.howToRestore).toContain("refs/omo/wip/run3")
  })
})
