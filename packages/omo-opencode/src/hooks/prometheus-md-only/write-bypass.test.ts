import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { clearSessionAgent, setSessionAgent } from "../../features/claude-code-session-state"

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
  resetSqliteBackendCache: () => {},
}))

afterAll(() => {
  mock.restore()
})

const { createPrometheusMdOnlyHook } = await import("./index")

const SESSION = "ses_prometheus_bypass"
const BLOCKED = "File operations restricted to .omo/*.md plan files only"

function hook() {
  return createPrometheusMdOnlyHook({ client: {}, directory: "/tmp/test" } as never)
}

function call(tool: string, args: Record<string, unknown>) {
  return hook()["tool.execute.before"]({ tool, sessionID: SESSION, callID: "call-1" }, { args })
}

function patch(...headers: string[]): string {
  return ["*** Begin Patch", ...headers.flatMap((header) => [header, "+x"]), "*** End Patch"].join("\n")
}

describe("prometheus-md-only closes every write path (fork 0.4)", () => {
  beforeEach(() => setSessionAgent(SESSION, "prometheus"))
  afterEach(() => clearSessionAgent(SESSION))

  test("apply_patch adding or updating a file outside .omo is blocked", async () => {
    await expect(call("apply_patch", { patchText: patch("*** Add File: src/x.ts") })).rejects.toThrow(BLOCKED)
    await expect(call("apply_patch", { patchText: patch("*** Update File: src/app.ts") })).rejects.toThrow(BLOCKED)
  })

  test("apply_patch touching only .omo plan files is allowed", async () => {
    await expect(call("apply_patch", { patchText: patch("*** Update File: .omo/plans/a.md") })).resolves.toBeUndefined()
  })

  test("apply_patch moving or deleting outside .omo is blocked", async () => {
    await expect(call("apply_patch", { patchText: patch("*** Update File: .omo/plans/a.md", "*** Move to: src/a.ts") })).rejects.toThrow(BLOCKED)
    await expect(call("apply_patch", { patchText: ["*** Begin Patch", "*** Delete File: src/old.ts", "*** End Patch"].join("\n") })).rejects.toThrow(BLOCKED)
  })

  test("hashline edit renaming a plan into the source tree is blocked", async () => {
    await expect(call("edit", { filePath: ".omo/drafts/x.md", rename: "src/app.ts" })).rejects.toThrow(BLOCKED)
  })

  test("multiedit, lsp rename and ast-grep rewrite are blocked", async () => {
    await expect(call("multiedit", { filePath: "src/a.ts", edits: [] })).rejects.toThrow(BLOCKED)
    await expect(call("lsp_rename", { filePath: ".omo/plans/a.md", newName: "x" })).rejects.toThrow(BLOCKED)
    await expect(call("ast_grep_rewrite", { pattern: "a", rewrite: "b" })).rejects.toThrow(BLOCKED)
  })

  test("a write tool with no extractable path fails closed", async () => {
    await expect(call("write", { content: "x" })).rejects.toThrow(BLOCKED)
    await expect(call("apply_patch", { patchText: "garbage" })).rejects.toThrow(BLOCKED)
  })

  test("tool names are matched case-insensitively", async () => {
    await expect(call("Apply_Patch", { patchText: patch("*** Add File: src/x.ts") })).rejects.toThrow(BLOCKED)
  })
})
