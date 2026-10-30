import { describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Fork finding H31 (21-10-2026): a test run left hundreds of folders in /tmp (the preloads' own HOME and XDG roots,
// and every fixture made with mkdtemp(tmpdir())). The preloads give each test process its own temp root and delete it
// when the process exits.
const REPO = join(import.meta.dir, "..")

describe("test temp cleanup", () => {
  test("#given a test that creates temp folders #when its process ends #then nothing is left in TMPDIR", () => {
    // given
    const work = mkdtempSync(join(tmpdir(), "omo-leak-work-"))
    const outer = mkdtempSync(join(tmpdir(), "omo-leak-tmp-"))
    writeFileSync(
      join(work, "leak.test.ts"),
      `import { test } from "bun:test"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; test("makes a fixture", () => { writeFileSync(join(mkdtempSync(join(tmpdir(), "fixture-")), "a.txt"), "x") })`,
    )

    // when
    const run = Bun.spawnSync(["bun", "test", "--preload", join(REPO, "test-env.ts"), "--preload", join(REPO, "test-setup.ts"), "./leak.test.ts"], {
      cwd: work,
      env: { ...process.env, TMPDIR: outer },
    })

    // then
    const left = readdirSync(outer)
    rmSync(work, { recursive: true, force: true })
    rmSync(outer, { recursive: true, force: true })
    expect(run.exitCode).toBe(0)
    expect(left).toEqual([])
  })
})
