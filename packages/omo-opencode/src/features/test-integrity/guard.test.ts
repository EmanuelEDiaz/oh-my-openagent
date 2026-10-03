import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createTestIntegrityGuard } from "./guard"

let dir = ""
let agent: string | undefined
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "test-integrity-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/sum.ts"), "export const sum = (a: number, b: number) => a - b\n")
  writeFileSync(join(dir, "src/sum.test.ts"), [
    'import { expect, test } from "bun:test"',
    'import { sum } from "./sum"',
    'test("adds", () => {',
    "  expect(sum(1, 2)).toBe(3)",
    "  expect(sum(2, 2)).toBe(4)",
    "})",
    "",
  ].join("\n"))
  agent = "sisyphus"
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function guard() {
  return createTestIntegrityGuard({ directory: dir, agentOf: async () => agent, rootOf: async (id) => id.replace(/-child$/, "") })
}

async function blocked(run: Promise<unknown>): Promise<string> {
  try {
    await run
  } catch (error) {
    return (error as Error).message
  }
  return ""
}

const testFile = () => join(dir, "src/sum.test.ts")

describe("test-integrity guard (fork 0.9a)", () => {
  test("an implementer cannot edit an existing test, and is told to stop and ask", async () => {
    const message = await blocked(guard().before("edit", "s", "c1", { filePath: testFile(), oldString: "toBe(3)", newString: "toBe(-1)" }))
    expect(message).toContain("existing test")
    expect(message).toContain("Allow editing src/sum.test.ts")
  })

  test("the user's answer to the question tool unlocks the file for the whole session tree", async () => {
    const g = guard()
    const note = await g.after({ tool: "question", sessionID: "s", callID: "q", args: {} }, { metadata: { answers: [["Allow editing src/sum.test.ts"]] } })
    expect(note).toContain("allowed editing")
    expect(await blocked(g.before("edit", "s-child", "c2", { filePath: testFile(), oldString: "toBe(3)", newString: "toBe(-1)" }))).toBe("")
  })

  test("skips, removed assertions, weakened assertions and self-mocks are blocked even for test-writer", async () => {
    agent = "test-writer"
    const g = guard()
    expect(await blocked(g.before("edit", "s", "a", { filePath: testFile(), oldString: 'test("adds"', newString: 'test.skip("adds"' }))).toContain("skips or focuses")
    expect(await blocked(g.before("edit", "s", "b", { filePath: testFile(), oldString: "  expect(sum(2, 2)).toBe(4)\n", newString: "" }))).toContain("removes 1 assertion")
    expect(await blocked(g.before("edit", "s", "c", { filePath: testFile(), oldString: "expect(sum(1, 2)).toBe(3)", newString: "expect(sum(1, 2)).toBeDefined()" }))).toContain("weaker")
    expect(await blocked(g.before("edit", "s", "d", { filePath: testFile(), oldString: 'import { sum } from "./sum"', newString: 'import { sum } from "./sum"\nmock.module("./sum", () => ({ sum: () => 3 }))' }))).toContain("mocks the module under test")
    expect(await blocked(g.before("edit", "s", "e", { filePath: testFile(), oldString: "  expect(sum(2, 2)).toBe(4)", newString: "  expect(sum(2, 2)).toBe(4)\n  expect(sum(0, 0)).toBe(0)" }))).toBe("")
  })

  test("test-writer writes tests only; anyone adding a type suppression is blocked", async () => {
    agent = "test-writer"
    expect(await blocked(guard().before("write", "s", "a", { filePath: join(dir, "src/sum.ts"), content: "x" }))).toContain("writes tests only")
    agent = "sisyphus"
    const message = await blocked(guard().before("apply_patch", "s", "b", { patchText: "*** Begin Patch\n*** Update File: src/sum.ts\n@@\n+// @ts-ignore\n export const sum\n*** End Patch" }))
    expect(message).toContain("suppression")
  })

  test("any and test literals only warn", async () => {
    const g = guard()
    await g.before("edit", "s", "w", { filePath: join(dir, "src/sum.ts"), oldString: "a - b", newString: 'a + (b as any) + (String(a) === "adds" ? 0 : 0)' })
    const note = await g.after({ tool: "edit", sessionID: "s", callID: "w", args: {} }, {})
    expect(note).toContain("`any`")
    expect(note).toContain('value taken from the tests ("adds")')
  })

  test("a new test must fail before the fix and pass after it", async () => {
    agent = "test-writer"
    const g = guard()
    const newTest = join(dir, "src/sub.test.ts")
    await g.before("write", "tw", "w1", { filePath: newTest, content: 'test("x", () => expect(1).toBe(2))' })
    writeFileSync(newTest, 'test("x", () => expect(1).toBe(2))')
    await g.after({ tool: "write", sessionID: "tw", callID: "w1", args: {} }, {})

    const failing = await g.after({ tool: "bash", sessionID: "tw", callID: "b1", args: { command: "bun test src/sub.test.ts" } }, { output: "expect(received).toBe(expected)\n1 fail", metadata: { exit: 1 } })
    expect(failing).toContain("reproduces the problem")
    const parent = await g.after({ tool: "task", sessionID: "p", callID: "t", args: {} }, { output: "done", metadata: { sessionId: "tw" } })
    expect(parent).toContain("fails for the right reason")

    agent = "sisyphus"
    await g.before("edit", "p", "e1", { filePath: join(dir, "src/sum.ts"), oldString: "a - b", newString: "a + b" })
    await g.after({ tool: "edit", sessionID: "p", callID: "e1", args: {} }, {})
    const passing = await g.after({ tool: "bash", sessionID: "p", callID: "b2", args: { command: "bun test" } }, { output: "2 pass", metadata: { exit: 0 } })
    expect(passing).toContain("valid test")
  })

  test("a new test that passes straight away, or fails for the wrong reason, is called out", async () => {
    const g = guard()
    const newTest = join(dir, "src/other.test.ts")
    await g.before("write", "s", "w", { filePath: newTest, content: "x" })
    await g.after({ tool: "write", sessionID: "s", callID: "w", args: {} }, {})
    const wrong = await g.after({ tool: "bash", sessionID: "s", callID: "b", args: { command: "bun test src/other.test.ts" } }, { output: "error: Cannot find module './nope'", metadata: { exit: 1 } })
    expect(wrong).toContain("WRONG reason")
    const passes = await g.after({ tool: "bash", sessionID: "s", callID: "b2", args: { command: "bun test src/other.test.ts" } }, { output: "1 pass", metadata: { exit: 0 } })
    expect(passes).toContain("passes before any code change")
  })

  test("hashline edits are judged after they run and undone if they cheat", async () => {
    const g = guard()
    const before = readFileSync(testFile(), "utf8")
    // test-writer may touch tests; the cheat is only visible once applied
    agent = "test-writer"
    await g.before("edit", "s", "h", { filePath: testFile(), edits: [{ op: "replace", pos: "4#AB", lines: null }] })
    writeFileSync(testFile(), before.replace("  expect(sum(1, 2)).toBe(3)\n", ""))
    const note = await g.after({ tool: "edit", sessionID: "s", callID: "h", args: {} }, {})
    expect(note).toContain("UNDONE")
    expect(readFileSync(testFile(), "utf8")).toBe(before)
  })
})
