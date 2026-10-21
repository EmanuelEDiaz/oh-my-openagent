import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { snapshotTests, undoTestChanges } from "./shell-writes"

const ORIGINAL = 'import { expect, test } from "bun:test"\ntest("sum", () => expect(1 + 1).toBe(6))\n'
let dir = ""

function sh(command: string): void {
  const result = Bun.spawnSync(["bash", "-c", command], { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" } })
  if (result.exitCode !== 0) throw new Error(`${command}: ${result.stderr.toString()}`)
}

const testPath = () => join(dir, "tests/round.test.ts")
const allowNone = () => false

describe("shell writes to existing tests (fork 0.9a, found by the bench 19-10-2026)", () => {
  describe("#given a git project", () => {
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "shell-writes-"))
      mkdirSync(join(dir, "tests"))
      mkdirSync(join(dir, "src"))
      writeFileSync(testPath(), ORIGINAL)
      writeFileSync(join(dir, "src/round.ts"), "export const r = Math.round\n")
      sh("git init -q && git add -A && git commit -qm fixture")
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    test("#when a command edits a test in place (the bench case: sed -i) #then it is put back and reported", () => {
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(6)/toBe(2)/' tests/round.test.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
    })

    test("#when a command overwrites or deletes a test #then both are put back", () => {
      writeFileSync(join(dir, "tests/other.test.ts"), "test('x', () => {})\n")
      sh("git add -A && git commit -qm two")
      const snapshot = snapshotTests(dir)
      sh("echo 'test.skip(\"sum\", () => {})' > tests/round.test.ts && rm tests/other.test.ts")
      expect(undoTestChanges(snapshot, allowNone).sort()).toEqual(["tests/other.test.ts", "tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
      expect(existsSync(join(dir, "tests/other.test.ts"))).toBe(true)
    })

    test("#when the change is staged and committed in the same command #then the test is still put back", () => {
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(6)/toBe(2)/' tests/round.test.ts && git add -A && git commit -qm 'fix test'")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
    })

    test("#when a test was already changed before the command #then it goes back to that state, not to the commit", () => {
      const allowedEdit = ORIGINAL.replace("toBe(6)", "toBe(2)")
      writeFileSync(testPath(), allowedEdit)
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(2)/toBeDefined()/' tests/round.test.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(allowedEdit)
    })

    test("#when a command creates a new test or changes source code #then nothing is undone", () => {
      const snapshot = snapshotTests(dir)
      sh("echo 'test(\"new\", () => {})' > tests/new.test.ts && sed -i 's/round/floor/' src/round.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual([])
      expect(existsSync(join(dir, "tests/new.test.ts"))).toBe(true)
      expect(readFileSync(join(dir, "src/round.ts"), "utf8")).toContain("floor")
    })

    test("#when the user allowed editing that test #then the change is kept", () => {
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(6)/toBe(2)/' tests/round.test.ts")
      expect(undoTestChanges(snapshot, (path) => path === testPath())).toEqual([])
      expect(readFileSync(testPath(), "utf8")).toContain("toBe(2)")
    })
  })

  describe("#given a project that is a subfolder of a bigger git repository", () => {
    let root = ""
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "shell-writes-mono-"))
      dir = join(root, "packages/app")
      mkdirSync(join(dir, "tests"), { recursive: true })
      writeFileSync(testPath(), ORIGINAL)
      writeFileSync(join(root, "root.test.ts"), "outside\n")
      sh("git init -q && git add -A && git commit -qm fixture")
    })
    afterEach(() => rmSync(root, { recursive: true, force: true }))

    test("#when a command edits a test of the project #then it is put back; tests outside the project are not its business", () => {
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(6)/toBe(2)/' tests/round.test.ts && echo changed > ../../root.test.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
    })
  })

  describe("#given a folder that is not a git repository", () => {
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "shell-writes-nogit-"))
      mkdirSync(join(dir, "tests"))
      writeFileSync(testPath(), ORIGINAL)
    })
    afterEach(() => rmSync(dir, { recursive: true, force: true }))

    test("#when a command edits or deletes a test #then it is put back from the copy taken before", () => {
      const snapshot = snapshotTests(dir)
      sh("sed -i 's/toBe(6)/toBe(2)/' tests/round.test.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
      sh("rm tests/round.test.ts")
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["tests/round.test.ts"])
      expect(readFileSync(testPath(), "utf8")).toBe(ORIGINAL)
    })

    test("#when tests sit in nested folders, node_modules or hidden folders #then only the project's own are guarded", () => {
      // given
      for (const folder of ["src/deep/er", "node_modules/pkg", ".cache"]) mkdirSync(join(dir, folder), { recursive: true })
      for (const path of ["src/deep/er/nested.test.ts", "node_modules/pkg/vendor.test.ts", ".cache/hidden.test.ts"]) writeFileSync(join(dir, path), ORIGINAL)
      const snapshot = snapshotTests(dir)

      // when
      sh("sed -i 's/toBe(6)/toBe(2)/' src/deep/er/nested.test.ts node_modules/pkg/vendor.test.ts .cache/hidden.test.ts")

      // then
      expect(undoTestChanges(snapshot, allowNone)).toEqual(["src/deep/er/nested.test.ts"])
      expect(readFileSync(join(dir, "src/deep/er/nested.test.ts"), "utf8")).toBe(ORIGINAL)
      expect(readFileSync(join(dir, "node_modules/pkg/vendor.test.ts"), "utf8")).not.toBe(ORIGINAL)
    })
  })
})
