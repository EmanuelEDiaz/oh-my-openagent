import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { createEditDiagnosticsHook } from "./index"

let project = ""

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "edit-diagnostics-hook-"))
  mkdirSync(join(project, "src"))
  writeFileSync(join(project, "src", "a.ts"), "export const a = 1\n")
  writeFileSync(join(project, "config.json"), '{ "a": 1 }\n')
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

const ctx = () => ({ directory: project }) as PluginInput
const config = (shellWrites = true) => ({ enabled: true, revert_syntax_errors: true, use_plugin_lsp: false, shell_writes: shellWrites })

async function runBash(hook: ReturnType<typeof createEditDiagnosticsHook>, command: string, write: () => void) {
  const input = { tool: "bash", sessionID: "ses_1", callID: "call_1" }
  await hook["tool.execute.before"](input, { args: { command } })
  write()
  const output = { title: "bash", output: "done", metadata: {} as Record<string, unknown> }
  await hook["tool.execute.after"](input, output)
  return output.output
}

describe("edit-diagnostics on shell writes", () => {
  // 0.27 baseline (28-10-2026): files rewritten with `cat > file <<'EOF'` skipped every edit check.
  test("#given a heredoc that breaks the syntax of an existing file #then the write is undone, as for the write tool", async () => {
    const hook = createEditDiagnosticsHook(ctx(), config(), {})
    const output = await runBash(hook, "cat > config.json <<'EOF'\n{ \"a\":\nEOF", () => writeFileSync(join(project, "config.json"), '{ "a":\n'))
    expect(readFileSync(join(project, "config.json"), "utf8")).toBe('{ "a": 1 }\n')
    expect(output).toContain("EDIT UNDONE")
    expect(output).toContain("[shell-write]")
  })

  test("#given a valid rewrite through the shell #then it stays, and the agent is told to use edit or write", async () => {
    const hook = createEditDiagnosticsHook(ctx(), config(), {})
    const output = await runBash(hook, "sed -i 's/1/2/' src/a.ts", () => writeFileSync(join(project, "src", "a.ts"), "export const a = 2\n"))
    expect(readFileSync(join(project, "src", "a.ts"), "utf8")).toBe("export const a = 2\n")
    expect(output.startsWith("done")).toBe(true)
    expect(output).toContain("[shell-write] src/a.ts")
    expect(output).not.toContain("EDIT UNDONE")
  })

  test("#given a command that only reads, or writes a new file #then the output is untouched", async () => {
    const hook = createEditDiagnosticsHook(ctx(), config(), {})
    expect(await runBash(hook, "cat src/a.ts | grep a", () => undefined)).toBe("done")
    expect(await runBash(hook, "echo x > src/new.ts", () => writeFileSync(join(project, "src", "new.ts"), "x\n"))).toBe("done")
  })

  test("#given shell_writes turned off #then shell writes are left alone", async () => {
    const hook = createEditDiagnosticsHook(ctx(), config(false), {})
    const output = await runBash(hook, "cat > src/a.ts <<'EOF'\nexport const a = (\nEOF", () => writeFileSync(join(project, "src", "a.ts"), "export const a = (\n"))
    expect(output).toBe("done")
    expect(readFileSync(join(project, "src", "a.ts"), "utf8")).toBe("export const a = (\n")
  })
})
