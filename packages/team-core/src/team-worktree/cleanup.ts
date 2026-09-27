import fs from "node:fs/promises"
import path from "node:path"

import type { TeamModeConfig } from "./manager"
import { spawn as bunSpawn } from "@oh-my-opencode/utils/runtime"

type GitResult = { code: number; stdout: string; stderr: string }

async function runGit(args: string[]): Promise<GitResult> {
  const child = bunSpawn({ cmd: ["git", ...args], stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false)
}

function registeredWorktrees(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
}

/**
 * Removes a linked git worktree. Decisions come from git state, never from parsing (localized) git
 * messages, and nothing is deleted unless git confirms the path is a linked worktree of a repo:
 * plain directories and a repo's main working tree are refused, and worktrees with uncommitted
 * changes are preserved.
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  if (!(await pathExists(worktreePath))) return
  const target = await fs.realpath(worktreePath)

  const commonDir = await runGit(["-C", target, "rev-parse", "--path-format=absolute", "--git-common-dir"])
  if (commonDir.code !== 0) throw new NotAWorktreeError(target, "not inside a git repository")
  const repoRoot = path.dirname(commonDir.stdout.trim())

  const topLevel = await runGit(["-C", target, "rev-parse", "--show-toplevel"])
  if (topLevel.code !== 0 || (await fs.realpath(topLevel.stdout.trim())) !== target) {
    throw new NotAWorktreeError(target, "not the root of a git worktree")
  }
  if (target === (await fs.realpath(repoRoot))) {
    throw new NotAWorktreeError(target, "it is the main working tree of the repository")
  }

  const list = await runGit(["-C", repoRoot, "worktree", "list", "--porcelain"])
  const registered = await Promise.all(registeredWorktrees(list.stdout).map((entry) => fs.realpath(entry).catch(() => entry)))
  if (list.code !== 0 || !registered.includes(target)) {
    throw new NotAWorktreeError(target, "not registered as a linked worktree")
  }

  const status = await runGit(["-C", target, "status", "--porcelain"])
  if (status.code !== 0) throw new NotAWorktreeError(target, "git status failed")
  if (status.stdout.trim().length > 0) throw new WorktreeHasChangesError(target)

  const removal = await runGit(["-C", repoRoot, "worktree", "remove", target])
  if (removal.code !== 0) throw new Error(removal.stderr.trim() || `git worktree remove failed for ${target}`)
  await runGit(["-C", repoRoot, "worktree", "prune"])
}

export async function findOrphanWorktrees(baseDir: string, _config: TeamModeConfig): Promise<string[]> {
  const orphanWorktrees: string[] = []
  const worktreesDir = path.join(baseDir, "worktrees")

  let teamRunDirectories: string[]
  try {
    teamRunDirectories = await fs.readdir(worktreesDir)
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    return orphanWorktrees
  }

  for (const teamRunId of teamRunDirectories) {
    const teamRunPath = path.join(worktreesDir, teamRunId)
    const memberNames = await fs.readdir(teamRunPath).catch((error: unknown) => {
      if (error instanceof Error) return []
      return []
    })

    for (const memberName of memberNames) {
      const worktreePath = path.join(teamRunPath, memberName)
      const statePath = path.join(baseDir, "runtime", teamRunId, "state.json")

      try {
        const stateContents = await fs.readFile(statePath, "utf8")
        const state = JSON.parse(stateContents) as { status?: string }

        if (state.status !== "active" && state.status !== "shutdown_requested") {
          orphanWorktrees.push(worktreePath)
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error
        }
        orphanWorktrees.push(worktreePath)
      }
    }
  }

  return orphanWorktrees
}

export class NotAWorktreeError extends Error {
  constructor(readonly worktreePath: string, reason: string) {
    super(`refusing to remove ${worktreePath}: ${reason}`)
    this.name = "NotAWorktreeError"
  }
}

export class WorktreeHasChangesError extends Error {
  constructor(readonly worktreePath: string) {
    super(`preserving ${worktreePath}: it has uncommitted changes`)
    this.name = "WorktreeHasChangesError"
  }
}
