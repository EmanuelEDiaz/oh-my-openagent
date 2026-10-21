import { describe, expect, test } from "bun:test"

import type { CheckDeps } from "../features/external-tools"
import { reportExternalToolsAtInstall } from "./install-external-tools"

// Fork 0.25 (21-10-2026): after a reinstall nothing said the TypeScript server was missing.
function deps(missing: readonly string[]): CheckDeps {
  return {
    which: (command) => (missing.includes(command) ? null : `/usr/bin/${command}`),
    run: async () => ({ exitCode: 0, firstLine: "v1" }),
    probe: async () => ({ status: "connects", ms: 5 }),
    resolveTypeScript6: () => ({ path: "/g/tsserver.js", version: "6.0.3", source: "global" }),
    globalTypeScriptDirs: () => [],
  }
}

describe("external tools at install", () => {
  test("#given the TypeScript server is missing #then the installer warns with what is lost and the durable fix", async () => {
    const lines: string[] = []
    const count = await reportExternalToolsAtInstall({ log: (line) => lines.push(line), deps: deps(["typescript-language-server"]) })
    expect(count).toBe(1)
    expect(lines[0]).toContain("TypeScript language server")
    expect(lines[0]).toContain("typescript@6")
    expect(lines[0]).toContain("postinstall")
  })

  test("#given everything installed #then the installer says nothing", async () => {
    const lines: string[] = []
    expect(await reportExternalToolsAtInstall({ log: (line) => lines.push(line), deps: deps([]) })).toBe(0)
    expect(lines).toEqual([])
  })

  test("#given a Python server is missing #then the installer does not mention it: no project yet", async () => {
    const lines: string[] = []
    await reportExternalToolsAtInstall({ log: (line) => lines.push(line), deps: deps(["basedpyright-langserver", "pyright-langserver", "gopls", "rust-analyzer"]) })
    expect(lines).toEqual([])
  })
})
