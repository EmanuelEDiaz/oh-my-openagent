import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { clearInterruption, listInterruptions, loadInterruption, recordInterruption } from "./store"

const dirs: string[] = []
const project = () => {
  const path = mkdtempSync(join(tmpdir(), "omo-interruption-"))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("interruption store", () => {
  test("records, lists and clears one entry per session", () => {
    const dir = project()
    recordInterruption(dir, { sessionID: "ses_a", cause: "network", detail: "no connection", at: 1 })
    recordInterruption(dir, { sessionID: "ses_a", cause: "killed", detail: "process killed", at: 2 })
    expect(loadInterruption(dir, "ses_a")?.cause).toBe("killed")
    expect(listInterruptions(dir)).toHaveLength(1)
    clearInterruption(dir, "ses_a")
    expect(listInterruptions(dir)).toEqual([])
  })

  test("a missing directory or entry is empty, not an error", () => {
    const dir = project()
    expect(listInterruptions(dir)).toEqual([])
    expect(loadInterruption(dir, "ses_x")).toBeUndefined()
    expect(() => clearInterruption(dir, "ses_x")).not.toThrow()
  })
})
