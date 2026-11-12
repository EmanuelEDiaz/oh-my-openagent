/**
 * Git facts the team rules need about the folder a command runs in (fork roadmap 0.28): the branch a team lead is on
 * (it may merge only in `team/<name>`) and whether a member works in a linked worktree (it may commit only there).
 */
import { isAbsolute, resolve } from "node:path"

/** The folder a shell command acts in: a leading `cd <dir> &&` or `git -C <dir>`, else the tool's working folder. */
export function commandDirectory(command: string, baseDir: string): string {
  const unquote = (value: string): string => value.replace(/^(["'])(.*)\1$/, "$2")
  const cd = /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*(&&|;)/.exec(command)
  const gitC = /(?:^|&&|;)\s*git\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)
  const target = cd?.[1] ?? gitC?.[1]
  if (!target) return baseDir
  const dir = unquote(target)
  return isAbsolute(dir) ? dir : resolve(baseDir, dir)
}

function git(dir: string, ...args: string[]): string | undefined {
  const result = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "ignore" })
  return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
}

export function currentBranch(dir: string): string | undefined {
  return git(dir, "branch", "--show-current") || undefined
}

/** True inside a worktree added with `git worktree add`, false in the repository's main folder (or outside git). */
export function isLinkedWorktree(dir: string): boolean {
  const gitDir = git(dir, "rev-parse", "--absolute-git-dir")
  const commonDir = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
  return gitDir !== undefined && commonDir !== undefined && gitDir !== commonDir
}
