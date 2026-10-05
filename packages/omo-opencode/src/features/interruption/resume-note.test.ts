import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildResumeNote, checkFileTool, checkPatchTool, createInterruptionNotes, INTERRUPTED_WORK_TAG, type SessionMessage } from "./resume-note"
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

  test("edit that inserts text (the new text contains the old) is applied once the new text is there", () => {
    const input = { filePath: "src/a.ts", oldString: "import a\n", newString: "import a\nimport b\n" }
    expect(checkFileTool("edit", input, dir, files({ "/p/src/a.ts": "import a\nimport b\nrest\n" })).check).toBe("applied")
    expect(checkFileTool("edit", input, dir, files({ "/p/src/a.ts": "import a\nrest\n" })).check).toBe("not-applied")
    // The old text also present outside the new one: neither state is certain.
    expect(checkFileTool("edit", { filePath: "x", oldString: "a()", newString: "b()" }, dir, files({ "/p/x": "a()\nb()\n" })).check).toBe("differs")
  })

  test("multiedit: every edit applied, none applied, or a mix", () => {
    const input = { filePath: "m.ts", edits: [{ oldString: "one", newString: "uno" }, { oldString: "two", newString: "dos" }] }
    expect(checkFileTool("multiedit", input, dir, files({ "/p/m.ts": "uno dos" })).check).toBe("applied")
    expect(checkFileTool("multiedit", input, dir, files({ "/p/m.ts": "one two" })).check).toBe("not-applied")
    expect(checkFileTool("multiedit", input, dir, files({ "/p/m.ts": "uno two" })).check).toBe("differs")
    expect(checkFileTool("multiedit", { filePath: "m.ts", edits: [{ oldString: "one" }] }, dir, files({ "/p/m.ts": "one" })).check).toBe("unknown")
  })

  test("apply_patch: each file by its added and removed lines; unreadable patch is unknown", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: src/u.ts",
      "@@ function f",
      " keep()",
      "-oldCall()",
      "+newCall()",
      "*** Add File: src/new.ts",
      "+export const x = 1",
      "*** Delete File: src/gone.ts",
      "*** End Patch",
    ].join("\n")
    const applied = files({ "/p/src/u.ts": "keep()\nnewCall()\n", "/p/src/new.ts": "export const x = 1\n" })
    expect(checkPatchTool({ patchText }, dir, applied)).toEqual([
      { file: "src/u.ts", check: "applied" },
      { file: "src/new.ts", check: "applied" },
      { file: "src/gone.ts", check: "applied" },
    ])
    const untouched = files({ "/p/src/u.ts": "keep()\noldCall()\n", "/p/src/gone.ts": "x" })
    expect(checkPatchTool({ patchText }, dir, untouched)?.map((entry) => entry.check)).toEqual(["not-applied", "not-applied", "not-applied"])
    expect(checkPatchTool({}, dir, untouched)).toBeUndefined()
    expect(checkPatchTool({ patchText: "garbage" }, dir, untouched)).toBeUndefined()
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

describe("buildResumeNote for multiedit and apply_patch", () => {
  test("checks half-done multiedit and apply_patch calls instead of the generic line", () => {
    const cut: SessionMessage[] = [{
      info: { role: "assistant" },
      parts: [
        { type: "tool", callID: "m1", tool: "multiedit", state: { status: "running", input: { filePath: "m.ts", edits: [{ oldString: "one", newString: "uno" }] } } },
        { type: "tool", callID: "p1", tool: "apply_patch", state: { status: "running", input: { patchText: "*** Begin Patch\n*** Update File: u.ts\n-old()\n+fresh()\n*** End Patch" } } },
        { type: "tool", callID: "p2", tool: "apply_patch", state: { status: "running", input: {} } },
      ],
    }]
    const note = buildResumeNote({ interruption: { ...interruption, tools: [], subtasks: [] }, messages: cut, projectDir: "/p", readFile: files({ "/p/m.ts": "uno", "/p/u.ts": "old()\n" }) })
    expect(note).toContain("multiedit m.ts: checked by the plugin: ALREADY APPLIED")
    expect(note).toContain("apply_patch u.ts: checked by the plugin: NOT applied")
    expect(note).toContain("apply_patch: could not be checked")
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
