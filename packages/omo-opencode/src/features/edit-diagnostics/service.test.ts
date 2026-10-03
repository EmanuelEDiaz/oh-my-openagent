import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { spawnSync } from "../../shared/bun-spawn-shim"
import { createEditDiagnostics } from "./service"

let dir = ""
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "edit-diag-")) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const diag = (line: number, message: string, code: number) => ({ range: { start: { line, character: 2 } }, message, severity: 1, code })
const hasPython = (() => { try { return spawnSync(["python3", "--version"], { stdout: "pipe", stderr: "pipe" }).exitCode === 0 } catch { return false } })()

describe("edit diagnostics (fork 0.9a)", async () => {
  test("first edit of a file: only errors on changed lines or naming touched identifiers are new; OpenCode's full list is replaced", async () => {
    const file = join(dir, "a.ts")
    writeFileSync(file, "const total = 1\nconst old: string = 5\nexport {}\n")
    const service = createEditDiagnostics({ directory: dir, revertSyntaxErrors: true })
    await service.before("edit", "c1", { filePath: file, oldString: "const total = 1", newString: "const total = totl + 1" })
    writeFileSync(file, "const total = totl + 1\nconst old: string = 5\nexport {}\n")
    const output = {
      output: `Edit applied successfully.\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\nERROR [1:15] Cannot find name 'totl'.\nERROR [2:7] Type 'number' is not assignable to type 'string'.\n</diagnostics>`,
      metadata: { diagnostics: { [file]: [diag(0, "Cannot find name 'totl'. Did you mean 'total'?", 2552), diag(1, "Type 'number' is not assignable to type 'string'.", 2322)] } },
    }
    await service.after({ tool: "edit", sessionID: "s", callID: "c1" }, output)
    expect(output.output).not.toContain("LSP errors detected")
    expect(output.output).toContain("NEW errors introduced by this edit (1)")
    expect(output.output).toContain("a.ts:1:3 2552 Cannot find name 'totl'")
    expect(output.output).toContain("did you mean: total")
    expect(output.output).toContain("1 other error(s) were already there")
  })

  test("later edits compare with the errors seen before, and report expected/actual", async () => {
    const file = join(dir, "b.ts")
    writeFileSync(file, "x\n")
    const seen: string[] = []
    const service = createEditDiagnostics({ directory: dir, revertSyntaxErrors: true, onNewErrors: (_s, errors) => seen.push(...errors.map((e) => e.message)) })
    const old = diag(5, "Type 'number' is not assignable to type 'string'.", 2322)
    await service.before("write", "w1", { filePath: file, content: "y\n" })
    writeFileSync(file, "y\n")
    await service.after({ tool: "write", sessionID: "s", callID: "w1" }, { output: "Wrote file", metadata: { diagnostics: { [file]: [old] } } })
    await service.before("write", "w2", { filePath: file, content: "z\n" })
    writeFileSync(file, "z\n")
    const output = { output: "Wrote file", metadata: { diagnostics: { [file]: [{ ...old, range: { start: { line: 9, character: 0 } } }, diag(2, "Argument of type 'string' is not assignable to parameter of type 'number'.", 2345)] } } }
    await service.after({ tool: "write", sessionID: "s", callID: "w2" }, output)
    expect(output.output).toContain("NEW errors introduced by this edit (1)")
    expect(output.output).toContain("expected number, got string")
    expect(seen.at(-1)).toContain("Argument of type")
  })

  test("a TS syntax error introduced by the edit undoes it", async () => {
    const file = join(dir, "c.ts")
    writeFileSync(file, "export const a = 1\n")
    const service = createEditDiagnostics({ directory: dir, revertSyntaxErrors: true })
    await service.before("edit", "e", { filePath: file, oldString: "= 1", newString: "= (1" })
    writeFileSync(file, "export const a = (1\n")
    const output = { output: "Edit applied successfully.", metadata: { diagnostics: { [file]: [diag(0, "')' expected.", 1005)] } } }
    await service.after({ tool: "edit", sessionID: "s", callID: "e" }, output)
    expect(output.output).toContain("EDIT UNDONE")
    expect(readFileSync(file, "utf8")).toBe("export const a = 1\n")
  })

  test.skipIf(!hasPython)("a Python edit that breaks the syntax is undone without a language server", async () => {
    const file = join(dir, "m.py")
    writeFileSync(file, "def f():\n    return 1\n")
    const service = createEditDiagnostics({ directory: dir, revertSyntaxErrors: true })
    await service.before("edit", "p", { filePath: file, oldString: "return 1", newString: "return (1" })
    writeFileSync(file, "def f():\n    return (1\n")
    const output = { output: "Edit applied successfully." }
    await service.after({ tool: "edit", sessionID: "s", callID: "p" }, output)
    expect(output.output).toContain("EDIT UNDONE")
    expect(readFileSync(file, "utf8")).toBe("def f():\n    return 1\n")
  })

  test("broken JSON is undone; tsconfig with comments is left alone", async () => {
    const file = join(dir, "data.json")
    writeFileSync(file, '{"a": 1}\n')
    const service = createEditDiagnostics({ directory: dir, revertSyntaxErrors: true })
    await service.before("write", "j", { filePath: file, content: '{"a": 1,}' })
    writeFileSync(file, '{"a": 1,}')
    const output = { output: "Wrote file" }
    await service.after({ tool: "write", sessionID: "s", callID: "j" }, output)
    expect(output.output).toContain("EDIT UNDONE")

    const tsconfig = join(dir, "tsconfig.json")
    writeFileSync(tsconfig, "{}\n")
    await service.before("write", "t", { filePath: tsconfig, content: "{ // c\n}" })
    writeFileSync(tsconfig, "{ // c\n}")
    const untouched = { output: "Wrote file" }
    await service.after({ tool: "write", sessionID: "s", callID: "t" }, untouched)
    expect(untouched.output).toBe("Wrote file")
  })

  test("hashline edits (no diagnostics from OpenCode) ask the plugin's LSP before and after, so the comparison is exact", async () => {
    const file = join(dir, "h.ts")
    writeFileSync(file, "const a: string = 1\nexport {}\n")
    const old = diag(0, "Type 'number' is not assignable to type 'string'.", 2322)
    let call = 0
    const service = createEditDiagnostics({
      directory: dir,
      revertSyntaxErrors: true,
      fallbackDiagnostics: async () => (call++ === 0 ? [old] : [old, diag(1, "Cannot find name 'nope'.", 2304)]),
    })
    await service.before("edit", "h", { filePath: file, edits: [{ op: "append", pos: "1#AA", lines: ["nope()"] }] })
    writeFileSync(file, "const a: string = 1\nnope()\nexport {}\n")
    const output = { output: "Updated h.ts" }
    await service.after({ tool: "edit", sessionID: "s", callID: "h" }, output)
    expect(output.output).toContain("NEW errors introduced by this edit (1)")
    expect(output.output).toContain("Cannot find name 'nope'")
    expect(output.output).toContain("1 other error(s) were already there")
  })
})
