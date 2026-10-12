/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTestIntegrityGuard } from "../test-integrity/guard"

// Fork roadmap 0.9c: type escapes and swallowed errors are refused in code, with the same way out as the test guard.
let dir = ""
const SOURCE = "export async function load(id: string): Promise<User> {\n  return fetchUser(id)\n}\n"

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "type-error-guard-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/load.ts"), SOURCE)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function guard(typeErrors = true) {
  return createTestIntegrityGuard({ directory: dir, agentOf: async () => "sisyphus", rootOf: async (id) => id, typeErrors })
}

async function blocked(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    return (error as Error).message
  }
  return ""
}

const file = () => join(dir, "src/load.ts")
const swallow = { filePath: "src/load.ts", oldString: "  return fetchUser(id)", newString: "  try {\n    return fetchUser(id)\n  } catch (e) {\n    return null\n  }" }

describe("type and error guard on edits", () => {
  test("an edit that swallows the error is refused with the alternative and the way out", async () => {
    const message = await blocked(guard().before("edit", "s", "c1", swallow))
    expect(message).toContain("[type-guard] BLOCKED")
    expect(message).toContain("swallows an error")
    expect(message).toContain("cause")
    expect(message).toContain('"Allow editing src/load.ts"')
  })

  test("a write that adds `as any` is refused", async () => {
    const message = await blocked(guard().before("write", "s", "c2", { filePath: file(), content: SOURCE.replace("fetchUser(id)", "fetchUser(id) as any") }))
    expect(message).toContain("adds `any`")
  })

  test("after the user allows the file, the same edit goes through", async () => {
    const g = guard()
    await g.after({ tool: "question", sessionID: "s", callID: "q", args: {} }, { metadata: { answers: [["Allow editing src/load.ts"]] } })
    expect(await blocked(g.before("edit", "s", "c3", swallow))).toBe("")
  })

  test("a clean edit is not touched", async () => {
    const edit = { filePath: "src/load.ts", oldString: "  return fetchUser(id)", newString: "  const user = await fetchUser(id)\n  return user" }
    expect(await blocked(guard().before("edit", "s", "c4", edit))).toBe("")
  })

  test("with the guard switched off (user config only) it does nothing", async () => {
    expect(await blocked(guard(false).before("edit", "s", "c5", swallow))).toBe("")
  })

  test("an apply_patch that swallows the error is undone after it runs", async () => {
    const g = guard()
    const patch = "*** Begin Patch\n*** Update File: src/load.ts\n@@\n-  return fetchUser(id)\n+  try { return fetchUser(id) } catch {}\n*** End Patch"
    await g.before("apply_patch", "s", "c6", { patchText: patch })
    writeFileSync(file(), SOURCE.replace("  return fetchUser(id)", "  try { return fetchUser(id) } catch {}"))
    const note = await g.after({ tool: "apply_patch", sessionID: "s", callID: "c6", args: { patchText: patch } }, {})
    expect(note).toContain("UNDONE")
    expect(readFileSync(file(), "utf8")).toBe(SOURCE)
  })
})
