/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { findOrphanWorktrees, NotAWorktreeError, removeWorktree, WorktreeHasChangesError } from "./cleanup"

const temporaryDirectories: string[] = []

afterAll(async () => {
  for (const directory of temporaryDirectories) {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test("given runtime mismatch when findOrphanWorktrees then returns orphan paths", async () => {
  // given
  const baseDir = await fs.mkdtemp(path.join(tmpdir(), "team-worktree-orphans-"))
  temporaryDirectories.push(baseDir)
  await fs.mkdir(path.join(baseDir, "worktrees", "t1", "m1"), { recursive: true })
  await fs.mkdir(path.join(baseDir, "runtime", "t1"), { recursive: true })
  await fs.writeFile(path.join(baseDir, "runtime", "t1", "state.json"), JSON.stringify({ status: "deleted" }))

  // when
  const result = await findOrphanWorktrees(baseDir, {})

  // then
  expect(result).toEqual([path.join(baseDir, "worktrees", "t1", "m1")])
})

async function git(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(["git", "-c", "user.email=qa@example.com", "-c", "user.name=qa", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`)
  return stdout
}

async function createRepo(): Promise<string> {
  const repo = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "team-worktree-repo-")))
  temporaryDirectories.push(repo)
  await git(["init", "-q"], repo)
  await fs.writeFile(path.join(repo, "README.md"), "hello\n")
  await git(["add", "."], repo)
  await git(["commit", "-q", "-m", "init"], repo)
  return repo
}

describe("removeWorktree safety", () => {
  test("#given a plain directory that is not a git worktree #then it refuses and deletes nothing", async () => {
    // given
    const directory = await fs.mkdtemp(path.join(tmpdir(), "team-worktree-user-dir-"))
    temporaryDirectories.push(directory)
    await fs.writeFile(path.join(directory, "important.txt"), "user data")

    // when
    const attempt = removeWorktree(directory)

    // then
    await expect(attempt).rejects.toBeInstanceOf(NotAWorktreeError)
    expect(await fs.readFile(path.join(directory, "important.txt"), "utf8")).toBe("user data")
  })

  test("#given the main working tree of a repo #then it refuses to remove it", async () => {
    // given
    const repo = await createRepo()

    // when
    const attempt = removeWorktree(repo)

    // then
    await expect(attempt).rejects.toBeInstanceOf(NotAWorktreeError)
    expect(await fs.readFile(path.join(repo, "README.md"), "utf8")).toBe("hello\n")
  })

  test("#given a clean linked worktree #then it is removed from disk and from git", async () => {
    // given
    const repo = await createRepo()
    const worktree = path.join(repo, "..", `${path.basename(repo)}-wt-clean`)
    temporaryDirectories.push(worktree)
    await git(["worktree", "add", "-q", "--detach", worktree], repo)

    // when
    await removeWorktree(worktree)

    // then
    await expect(fs.access(worktree)).rejects.toBeDefined()
    expect(await git(["worktree", "list", "--porcelain"], repo)).not.toContain(worktree)
  })

  test("#given a linked worktree with uncommitted changes #then it is preserved", async () => {
    // given
    const repo = await createRepo()
    const worktree = path.join(repo, "..", `${path.basename(repo)}-wt-dirty`)
    temporaryDirectories.push(worktree)
    await git(["worktree", "add", "-q", "--detach", worktree], repo)
    await fs.writeFile(path.join(worktree, "work-in-progress.ts"), "export {}\n")

    // when
    const attempt = removeWorktree(worktree)

    // then
    await expect(attempt).rejects.toBeInstanceOf(WorktreeHasChangesError)
    expect(await fs.readFile(path.join(worktree, "work-in-progress.ts"), "utf8")).toBe("export {}\n")
  })

  test("#given a path that no longer exists #then it is a no-op", async () => {
    // when / then
    await removeWorktree(path.join(tmpdir(), "team-worktree-missing-path-xyz"))
  })
})
