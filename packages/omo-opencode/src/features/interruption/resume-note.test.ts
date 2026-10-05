import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildResumeNote, checkFileTool, createInterruptionNotes, INTERRUPTED_WORK_TAG, type SessionMessage } from "./resume-note"
import { loadInterruption, recordInterruption, type Interruption } from "./store"

const dirs: string[] = []
const project = () => {
  const path = mkdtempSync(join(tmpdir(), "omo-note-"))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

const files = (map: Record<string, string>) => (path: string) => map[path]

describe("checkFileTool (the plugin checks half-done edits itself)", () => {
  const dir = "/p"
  test("edit: applied, not applied, differs", () => {
    const input = { filePath: "src/a.ts", oldString: "const a = 1", newString: "const a = 2" }
    expect(checkFileTool("edit", input, dir, files({ "/p/src/a.ts": "x\nconst a = 2\n" })).check).toBe("applied")
    expect(checkFileTool("edit", input, dir, files({ "/p/src/a.ts": "x\nconst a = 1\n" })).check).toBe("not-applied")
    expect(checkFileTool("edit", input, dir, files({ "/p/src/a.ts": "something else" })).check).toBe("differs")
    expect(checkFileTool("edit", input, dir, files({})).check).toBe("missing")
  })

  test("edit that deletes text counts as applied once the old text is gone", () => {
    const input = { filePath: "/abs/b.ts", oldString: "debugger;\n", newString: "" }
    expect(checkFileTool("edit", input, dir, files({ "/abs/b.ts": "ok\n" })).check).toBe("applied")
    expect(checkFileTool("edit", input, dir, files({ "/abs/b.ts": "debugger;\nok\n" })).check).toBe("not-applied")
  })

  test("write: same content, missing file, other content", () => {
    const input = { filePath: "c.md", content: "hello" }
    expect(checkFileTool("write", input, dir, files({ "/p/c.md": "hello" })).check).toBe("applied")
    expect(checkFileTool("write", input, dir, files({})).check).toBe("not-applied")
    expect(checkFileTool("write", input, dir, files({ "/p/c.md": "bye" })).check).toBe("differs")
    expect(checkFileTool("write", {}, dir, files({})).check).toBe("unknown")
  })
})

const interruption: Interruption = {
  sessionID: "ses_a",
  cause: "killed",
  detail: "OpenCode was killed, probably for lack of RAM (earlyoom or similar)",
  at: 0,
  tools: [
    { callID: "c3", tool: "edit", summary: "src/a.ts" },
    { callID: "c4", tool: "bash", summary: "npm run migrate" },
  ],
  subtasks: ["ses_child"],
}

const messages: SessionMessage[] = [
  { info: { role: "user", id: "m0" }, parts: [{ type: "text" }] },
  {
    info: { role: "assistant", id: "m1" },
    parts: [
      { type: "tool", callID: "c1", tool: "read", state: { status: "completed", input: { filePath: "src/a.ts" } } },
      { type: "tool", callID: "c2", tool: "bash", state: { status: "completed", input: { command: "git status" } } },
      { type: "tool", callID: "c3", tool: "edit", state: { status: "running", input: { filePath: "src/a.ts", oldString: "old()", newString: "fresh()" } } },
      { type: "tool", callID: "c4", tool: "bash", state: { status: "running", input: { command: "npm run migrate" } } },
      { type: "tool", callID: "c5", tool: "write", state: { status: "error", error: "Tool execution aborted", input: { filePath: "b.txt", content: "B" } } },
    ],
  },
]

describe("buildResumeNote", () => {
  test("says what was cut, the done steps, checks edits and never re-runs bash blindly", () => {
    const note = buildResumeNote({
      interruption,
      messages,
      projectDir: "/p",
      now: 5 * 60_000,
      readFile: files({ "/p/src/a.ts": "fresh()\n" }),
    })
    expect(note.startsWith(INTERRUPTED_WORK_TAG)).toBe(true)
    expect(note).toContain("5 min ago")
    expect(note).toContain("lack of RAM")
    expect(note).toContain("Last completed step: bash git status.")
    expect(note).toContain("do NOT repeat")
    expect(note).toContain("- read src/a.ts")
    expect(note).toContain("edit src/a.ts: checked by the plugin: ALREADY APPLIED")
    expect(note).toContain("bash `npm run migrate`: never re-run it blindly")
    expect(note).toContain("write b.txt: checked by the plugin: NOT applied")
    expect(note).toContain("Subagents running at the cut: ses_child")
    expect(note).toContain("asks to continue or is ambiguous, resume from the last completed step")
    expect(note).toContain("/undo")
  })

  test("a tool that completed after all is not half-done; an empty session still gets the rule", () => {
    const done: SessionMessage[] = [{ info: { role: "assistant" }, parts: [{ type: "tool", callID: "c4", tool: "bash", state: { status: "completed", input: { command: "npm run migrate" } } }] }]
    const note = buildResumeNote({ interruption: { ...interruption, tools: [interruption.tools![1]!], subtasks: [] }, messages: done, projectDir: "/p" })
    expect(note).not.toContain("Half-done")
    expect(buildResumeNote({ interruption: { ...interruption, tools: [] }, messages: [], projectDir: "/p" })).toContain("No step of the cut turn had completed.")
  })
})

describe("one-shot note", () => {
  test("is offered while the interruption exists and cleared only once the message is stored", async () => {
    const dir = project()
    recordInterruption(dir, { ...interruption, at: 10 })
    const notes = createInterruptionNotes({ projectDir: dir, fetchMessages: async () => messages })

    expect(await notes.noteFor("ses_a")).toContain(INTERRUPTED_WORK_TAG)
    expect(loadInterruption(dir, "ses_a")).toBeDefined()
    // A send that never reached OpenCode: the next message still gets the note.
    expect(await notes.noteFor("ses_a")).toContain(INTERRUPTED_WORK_TAG)

    notes.onEvent({ type: "message.updated", properties: { info: { sessionID: "ses_other", role: "user" } } })
    expect(loadInterruption(dir, "ses_a")).toBeDefined()
    notes.onEvent({ type: "message.updated", properties: { info: { sessionID: "ses_a", role: "user" } } })
    expect(loadInterruption(dir, "ses_a")).toBeUndefined()
    expect(await notes.noteFor("ses_a")).toBeUndefined()
  })

  test("a newer cut recorded before the confirmation is kept", async () => {
    const dir = project()
    recordInterruption(dir, { ...interruption, at: 10 })
    const notes = createInterruptionNotes({ projectDir: dir, fetchMessages: async () => { throw new Error("offline") } })
    expect(await notes.noteFor("ses_a")).toContain("No step of the cut turn had completed.")
    recordInterruption(dir, { ...interruption, at: 20, cause: "network", detail: "no connection" })
    notes.onEvent({ type: "message.updated", properties: { info: { sessionID: "ses_a", role: "assistant" } } })
    expect(loadInterruption(dir, "ses_a")?.at).toBe(20)
  })

  test("reads real files relative to the project", () => {
    const dir = project()
    writeFileSync(join(dir, "x.ts"), "new text")
    expect(checkFileTool("edit", { filePath: "x.ts", oldString: "old text", newString: "new text" }, dir).check).toBe("applied")
  })
})
