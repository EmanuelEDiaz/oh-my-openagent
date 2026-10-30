import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createCommentCheckerHooks } from "./hook"

let project = ""

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "comment-checker-shell-"))
  mkdirSync(join(project, "src"))
  writeFileSync(join(project, "src", "a.ts"), "export const a = 1\n")
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

function runner() {
  return {
    initializeCommentCheckerCli: () => {},
    getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
    isCliPathUsable: () => true,
    processWithCli: mock(async () => {}),
    processApplyPatchEditsWithCli: mock(async () => {}),
  }
}

describe("comment-checker on shell writes", () => {
  // 0.27 baseline (28-10-2026): files rewritten with `cat > file <<'EOF'` never reached the comment checker.
  it("#given an existing file rewritten through bash #then its change is checked like an apply_patch edit", async () => {
    const cli = runner()
    const hooks = createCommentCheckerHooks(undefined, cli, project)
    const input = { tool: "bash", sessionID: "ses_1", callID: "call_1" }
    await hooks["tool.execute.before"](input, { args: { command: "cat > src/a.ts <<'EOF'\n// set a\nexport const a = 2\nEOF" } })
    writeFileSync(join(project, "src", "a.ts"), "// set a\nexport const a = 2\n")
    const output = { title: "bash", output: "", metadata: {} }
    await hooks["tool.execute.after"](input, output)
    expect(cli.processApplyPatchEditsWithCli).toHaveBeenCalledTimes(1)
    expect(cli.processApplyPatchEditsWithCli.mock.calls[0]?.[1]).toEqual([
      { filePath: join(project, "src", "a.ts"), before: "export const a = 1\n", after: "// set a\nexport const a = 2\n" },
    ])
  })

  it("#given a bash call that writes nothing existing #then the checker is not run", async () => {
    const cli = runner()
    const hooks = createCommentCheckerHooks(undefined, cli, project)
    const input = { tool: "bash", sessionID: "ses_1", callID: "call_2" }
    await hooks["tool.execute.before"](input, { args: { command: "cat src/a.ts" } })
    await hooks["tool.execute.after"](input, { title: "bash", output: "export const a = 1", metadata: {} })
    expect(cli.processApplyPatchEditsWithCli).not.toHaveBeenCalled()
  })
})
