import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLoopBreakerHook } from "./index"

let dir = ""
const toasts: string[] = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-hook-"))
  mkdirSync(join(dir, "src"))
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1\n")
  toasts.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function hook() {
  const ctx = {
    directory: dir,
    client: {
      session: { get: async () => ({ data: {} }) },
      tui: { showToast: async (input: { body: { message: string } }) => { toasts.push(input.body.message) } },
    },
  } as never
  return createLoopBreakerHook(ctx, undefined, 6)
}

const FAIL = "(fail) adds [1.2ms]\nerror: expect(received).toBe(expected)\nExpected: 3\nReceived: -1"
let call = 0
async function bash(h: ReturnType<typeof hook>, exit: number, output = FAIL) {
  const out = { output, metadata: { exit } as Record<string, unknown> }
  await h["tool.execute.after"]({ tool: "bash", sessionID: "s", callID: `b${call++}`, args: { command: "bun test" } }, out)
  return out.output
}
async function edit(h: ReturnType<typeof hook>, text: string) {
  const args = { filePath: join(dir, "src/a.ts"), oldString: "export const a = 1", newString: text }
  const id = `e${call++}`
  await h["tool.execute.before"]({ tool: "edit", sessionID: "s", callID: id }, { args })
  await h["tool.execute.after"]({ tool: "edit", sessionID: "s", callID: id, args }, { output: "Edit applied successfully." })
}
async function blocked(h: ReturnType<typeof hook>): Promise<string> {
  try {
    await h["tool.execute.before"]({ tool: "edit", sessionID: "s", callID: `x${call++}` }, { args: { filePath: join(dir, "src/a.ts"), oldString: "a", newString: "b" } })
    return ""
  } catch (error) {
    return (error as Error).message
  }
}

describe("loop breaker hook (fork 0.9b)", () => {
  test("escalates on a failing test run that keeps coming back after edits, and blocks edits at level 3 until the debugger runs", async () => {
    const h = hook()
    await bash(h, 1)
    await edit(h, "export const a = 2")
    await bash(h, 1)
    await edit(h, "export const a = completely(different)")
    expect(await bash(h, 1)).toContain("came back after 2 fixes")
    await edit(h, "if (x) { return y } else { throw new Error('z') }")
    expect(await bash(h, 1)).toContain("BLOCKED until a fresh debugger")
    expect(await blocked(h)).toContain("[loop-breaker] BLOCKED")
    await h["tool.execute.after"]({ tool: "task", sessionID: "s", callID: "t1", args: { subagent_type: "debugger" } }, { output: "found it" })
    expect(await blocked(h)).toBe("")
  })

  test("level 4 waits for the user's answer to the question tool; a passing run clears the error", async () => {
    const h = hook()
    await bash(h, 1)
    await edit(h, "export const a = 2")
    await bash(h, 1)
    await edit(h, "export const a = 2 ")
    expect(await bash(h, 1)).toContain("almost identical fix")
    expect(await blocked(h)).toContain("Ask the user")
    await h["tool.execute.after"]({ tool: "question", sessionID: "s", callID: "q1", args: {} }, { output: "", metadata: { answers: [["Option B"]] } })
    expect(await blocked(h)).toBe("")
    await bash(h, 0, "1 pass")
    await edit(h, "export const a = 3")
    expect(await bash(h, 1)).not.toContain("[loop-breaker]")
  })

  test("its own refusals are not counted as errors, and a user message resets the budget", async () => {
    const h = hook()
    for (let i = 0; i < 5; i++) {
      await h.event({ event: { type: "message.part.updated", properties: { part: { type: "tool", tool: "edit", callID: `own${i}`, sessionID: "s", state: { status: "error", error: "[loop-breaker] BLOCKED: x" } } } } })
    }
    expect(h.breaker.budget("s").used).toBe(0)
    h.breaker.charge("s", "stall")
    await h["chat.message"]({ sessionID: "s" })
    expect(h.breaker.budget("s").used).toBe(0)
  })

  test("when the retry budget is spent the work is paused and the agent is told to stop", async () => {
    const ctx = { directory: dir, client: { session: { get: async () => ({ data: {} }) }, tui: { showToast: async (input: { body: { message: string } }) => { toasts.push(input.body.message) } } } } as never
    const h = createLoopBreakerHook(ctx, undefined, 1)
    await bash(h, 1)
    await edit(h, "export const a = 2")
    await bash(h, 1)
    await edit(h, "export const a = something else entirely")
    expect(await bash(h, 1)).toContain("STOP")
    expect(toasts.join(" ")).toContain("stopped")
  })

  test("stopping while blocked for the user saves the work and tells the user once", async () => {
    const h = hook()
    await bash(h, 1)
    await edit(h, "export const a = 2")
    await bash(h, 1)
    await edit(h, "export const a = 2 ")
    await bash(h, 1)
    await h.event({ event: { type: "session.idle", properties: { sessionID: "s" } } })
    await h.event({ event: { type: "session.idle", properties: { sessionID: "s" } } })
    expect(toasts.filter((t) => t.includes("needs your decision")).length).toBe(1)
  })
})
