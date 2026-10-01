import { describe, expect, test } from "bun:test"

import { createBuiltinMcps } from "./index"

// Kept apart from zauc-mocks-mcp-index: that file replaces ../lsp with mock.module, and mock.restore() does not undo
// module mocks, so this assertion on the real lsp config never ran against the real module there.
describe("createBuiltinMcps runtime resolution", () => {
  test("should resolve enabled local MCP runtime commands before registration", async () => {
    // given
    const nodePath = "/tmp/omo-runtime/node"
    const bunPath = "/tmp/omo-runtime/bun"

    // when
    const result = createBuiltinMcps([], undefined, {
      cwd: process.cwd(),
      resolveExecutable: (commandName: string) => {
        if (commandName === "node") return { command: nodePath, available: true }
        if (commandName === "bun") return { command: bunPath, available: true }
        return { command: commandName, available: false }
      },
    })

    // then
    expect(result.lsp?.type).toBe("local")
    if (result.lsp?.type !== "local") throw new Error("expected local MCP config")
    expect(["node", "bun"]).not.toContain(result.lsp.command[0])
    expect([nodePath, bunPath]).toContain(result.lsp.command[0])
  })
})
