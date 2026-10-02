/**
 * Repos the bench runs tasks in. A bundled fixture is a directory under fixtures/; a git fixture is a repo (local path
 * or URL) pinned to a commit or tag, extracted once into a local cache without its .git and never modified there.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

export type GitFixture = { readonly name: string; readonly repo: string; readonly ref: string }
export type Fixture = string | GitFixture

export function fixtureKey(fixture: GitFixture): string {
  return `${fixture.name}@${fixture.ref.slice(0, 12)}`.replaceAll(/[^\w@.-]/g, "_")
}

function run(command: string[], cwd?: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "ignore", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`)
}

/** The directory to copy for a task. Git fixtures are extracted on first use (network only for remote repos). */
export async function resolveFixture(fixture: Fixture, cacheDir: string): Promise<string> {
  if (typeof fixture === "string") {
    const dir = join(import.meta.dir, "fixtures", fixture)
    if (!existsSync(dir)) throw new Error(`unknown fixture ${fixture}`)
    return dir
  }
  const dir = join(cacheDir, fixtureKey(fixture))
  if (existsSync(dir)) return dir
  mkdirSync(cacheDir, { recursive: true })
  const staging = `${dir}.tmp-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  try {
    if (existsSync(fixture.repo)) {
      // Local repo: only committed content at the pinned commit, never the working tree.
      mkdirSync(staging, { recursive: true })
      run(["sh", "-c", `git -C "$0" archive "$1" | tar -x -C "$2"`, fixture.repo, fixture.ref, staging])
    } else {
      run(["git", "clone", "-q", "--depth", "1", "--branch", fixture.ref, fixture.repo, staging])
      rmSync(join(staging, ".git"), { recursive: true, force: true })
    }
    renameSync(staging, dir)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
  return dir
}
