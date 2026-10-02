import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { fixtureKey, resolveFixture } from "./fixtures"

const scratch = mkdtempSync(join(tmpdir(), "bench-fixtures-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): string {
  const run = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], { cwd })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}

describe("resolveFixture", () => {
  test("a bundled fixture name resolves to its directory", async () => {
    expect(await resolveFixture("ts-service", join(scratch, "cache"))).toBe(join(import.meta.dir, "fixtures/ts-service"))
  })

  test("a git fixture is extracted once at its pinned commit, without .git or later changes", async () => {
    const repo = join(scratch, "repo")
    Bun.spawnSync(["mkdir", "-p", repo])
    git(repo, "init", "-q")
    writeFileSync(join(repo, "a.txt"), "v1\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "one")
    const commit = git(repo, "rev-parse", "HEAD")
    writeFileSync(join(repo, "a.txt"), "v2 uncommitted\n")

    const fixture = { name: "local", repo, ref: commit }
    const dir = await resolveFixture(fixture, join(scratch, "cache"))
    expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("v1\n")
    expect(existsSync(join(dir, ".git"))).toBe(false)
    expect(dir).toContain(fixtureKey(fixture))

    writeFileSync(join(dir, "marker"), "cached")
    expect(await resolveFixture(fixture, join(scratch, "cache"))).toBe(dir)
    expect(existsSync(join(dir, "marker"))).toBe(true)
  })

  test("an unknown bundled fixture fails clearly", async () => {
    await expect(resolveFixture("nope", join(scratch, "cache"))).rejects.toThrow("unknown fixture")
  })
})
