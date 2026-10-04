import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { assertSafeSandboxRoot, createSandbox, destroySandbox, overrideAgentModels, prepareWorkdir, sandboxProcesses } from "./sandbox"

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

  test("finds processes left running with the sandbox's HOME (e.g. the LSP daemon) so destroySandbox can stop them", () => {
    const proc = mkdtempSync(join(tmpdir(), "fake-proc-"))
    const write = (pid: string, env: string[]) => {
      mkdirSync(join(proc, pid))
      writeFileSync(join(proc, pid, "environ"), env.join("\0"))
    }
    write("101", ["PATH=/bin", "HOME=/tmp/sb/home"])
    write("102", ["HOME=/home/user"])
    write("self", ["HOME=/tmp/sb/home"])
    expect(sandboxProcesses("/tmp/sb", proc)).toEqual([101])
    rmSync(proc, { recursive: true, force: true })
  })

  test("pins agent models in the sandbox copy of omo.jsonc only, dropping their fallback chains", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-bench-models-"))
    mkdirSync(join(root, "home/.omo"), { recursive: true })
    writeFileSync(join(root, "home/.omo/omo.jsonc"), '{\n  // comment\n  "[opencode]": { "agents": { "librarian": { "model": "a/b", "fallback_models": [{ "model": "c/d" }] } } }\n}')
    overrideAgentModels({ root, env: {} }, { "web-researcher": "x/free", librarian: "x/free" })
    const written = JSON.parse(readFileSync(join(root, "home/.omo/omo.jsonc"), "utf8"))
    expect(written["[opencode]"].agents).toEqual({ librarian: { model: "x/free" }, "web-researcher": { model: "x/free" } })
    rmSync(root, { recursive: true, force: true })
  })

  test("the sandbox defaults every unpinned agent to a free model", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-bench-free-"))
    rmSync(root, { recursive: true, force: true })
    const sandbox = createSandbox(root, join(import.meta.dir, "sandbox.ts"))
    const config = JSON.parse(readFileSync(join(root, "config/opencode/opencode.json"), "utf8"))
    expect(config.model).toBe("opencode/big-pickle")
    expect(config.small_model).toBe("opencode/big-pickle")
    destroySandbox(sandbox)
  })
})
