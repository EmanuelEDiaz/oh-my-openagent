import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assertPluginLoads } from "./plugin-check"

describe("assertPluginLoads (fork incident H57)", () => {
  test("accepts a plugin whose default export has a server function", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-check-"))
    writeFileSync(join(dir, "index.js"), "export default { id: 'ok', server: async () => ({}) }\n")
    await expect(assertPluginLoads(join(dir, "index.js"))).resolves.toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })

  test("refuses a plugin that cannot be imported, naming the missing dependency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-check-"))
    writeFileSync(join(dir, "index.js"), "import { z } from 'zod-missing-for-test'\nexport default { server: async () => z }\n")
    await expect(assertPluginLoads(join(dir, "index.js"))).rejects.toThrow(/does not load[\s\S]*zod-missing-for-test/)
    rmSync(dir, { recursive: true, force: true })
  })

  test("refuses a module that is not an OpenCode plugin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-check-"))
    writeFileSync(join(dir, "index.js"), "export default { id: 'not-a-plugin' }\n")
    await expect(assertPluginLoads(join(dir, "index.js"))).rejects.toThrow(/no server function/)
    rmSync(dir, { recursive: true, force: true })
  })

  test("names a missing file next to the build, not the code frame", async () => {
    const dir = mkdtempSync(join(tmpdir(), "plugin-check-"))
    writeFileSync(join(dir, "index.js"), "import { readFileSync } from 'node:fs'\nreadFileSync(new URL('./skills/frontend/SKILL.md', import.meta.url))\nexport default { server: async () => ({}) }\n")
    await expect(assertPluginLoads(join(dir, "index.js"))).rejects.toThrow(/ENOENT[^\n]*skills\/frontend\/SKILL\.md/)
    rmSync(dir, { recursive: true, force: true })
  })
})
