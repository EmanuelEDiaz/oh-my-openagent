import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeFileAtomically } from "./atomic-write"
import { createBoulderState, writeBoulderState } from "./write-state"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe("atomic boulder writes (fork 0.15)", () => {
  test("replaces the file and leaves no temp sibling", () => {
    dir = mkdtempSync(join(tmpdir(), "boulder-atomic-"))
    const path = join(dir, "state.json")
    writeFileAtomically(path, "one")
    writeFileAtomically(path, "two")
    expect(readFileSync(path, "utf-8")).toBe("two")
    expect(readdirSync(dir)).toEqual(["state.json"])
  })

  test("writeBoulderState leaves only boulder.json and .gitignore", () => {
    dir = mkdtempSync(join(tmpdir(), "boulder-atomic-"))
    expect(writeBoulderState(dir, createBoulderState(join(dir, "plan.md"), "ses_1"))).toBe(true)
    expect(readdirSync(join(dir, ".omo")).sort()).toEqual([".gitignore", "boulder.json"])
  })
})
