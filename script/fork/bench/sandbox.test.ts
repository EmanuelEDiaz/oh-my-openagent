import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { assertSafeSandboxRoot, createSandbox, destroySandbox, prepareWorkdir } from "./sandbox"

const scratch = mkdtempSync(join(tmpdir(), "bench-sandbox-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe("assertSafeSandboxRoot", () => {
  test("refuses the real home, a parent of it and OpenCode's real dirs", () => {
    expect(() => assertSafeSandboxRoot(homedir())).toThrow("refusing")
    expect(() => assertSafeSandboxRoot("/")).toThrow("refusing")
    expect(() => assertSafeSandboxRoot(join(homedir(), ".local/share/opencode/x"))).toThrow("refusing")
  })

  test("refuses an existing directory and accepts a new one", () => {
    expect(() => assertSafeSandboxRoot(scratch)).toThrow("existing")
    expect(() => assertSafeSandboxRoot(join(scratch, "new"))).not.toThrow()
  })
})

describe("createSandbox / prepareWorkdir / destroySandbox", () => {
  test("isolates XDG roots, loads only the plugin under test and cleans everything", () => {
    const plugin = join(scratch, "plugin.js")
    writeFileSync(plugin, "export default {}")
    const fixture = join(scratch, "fixture")
    Bun.spawnSync(["mkdir", "-p", join(fixture, "src")])
    writeFileSync(join(fixture, "src/a.ts"), "export const a = 1\n")

    const sandbox = createSandbox(join(scratch, "sb"), plugin)
    expect(sandbox.env.XDG_DATA_HOME).toBe(join(scratch, "sb/data"))
    expect(sandbox.env.HOME).toBe(join(scratch, "sb/home"))
    const config = JSON.parse(readFileSync(join(scratch, "sb/config/opencode/opencode.json"), "utf8"))
    expect(config.plugin).toEqual([`file://${plugin}`])

    const workdir = prepareWorkdir(sandbox, fixture, "t1")
    expect(existsSync(join(workdir, ".git"))).toBe(true)
    expect(readFileSync(join(workdir, "src/a.ts"), "utf8")).toBe("export const a = 1\n")

    destroySandbox(sandbox)
    expect(existsSync(join(scratch, "sb"))).toBe(false)
  })
})
