import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { referencedScripts } from "./scripts"

const dir = mkdtempSync(join(tmpdir(), "guard-scripts-"))
writeFileSync(join(dir, "commit-robot.sh"), "GIT_AUTHOR_NAME=Robot git commit -m x\n")
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Fork incident H50: blocked in the command, the agent wrote the same command into a script and ran it.
describe("referencedScripts", () => {
  test.each([
    `sh ${join(dir, "commit-robot.sh")} && git log -1`,
    "bash commit-robot.sh",
    "./commit-robot.sh",
    "source ./commit-robot.sh",
    ". commit-robot.sh",
    "zsh -e commit-robot.sh",
  ])("#given %s #then the script's text is returned", (command) => {
    expect(referencedScripts(command, dir)).toContain("GIT_AUTHOR_NAME=Robot")
  })

  test("#given commands that run no local script #then nothing is returned", () => {
    expect(referencedScripts("git status && bun test", dir)).toBe("")
    expect(referencedScripts("sh -c 'echo hi'", dir)).toBe("")
    expect(referencedScripts("bash missing.sh", dir)).toBe("")
  })
})
