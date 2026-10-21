import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkExternalTools, projectLanguages, type CheckDeps } from "./check"

// Fork 0.25 (21-10-2026): after a reinstall the TypeScript server was missing and nobody was told; then it was installed
// with TypeScript 7 and still could not start. Each needed tool is checked by really running it.
function project(...markers: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tools-"))
  for (const marker of markers) writeFileSync(join(dir, marker), "{}")
  return dir
}

function deps(overrides: Partial<CheckDeps> = {}): CheckDeps {
  return {
    which: (command) => `/usr/bin/${command}`,
    run: async () => ({ exitCode: 0, firstLine: "v1" }),
    probe: async () => ({ status: "connects", ms: 12, typescriptVersion: "6.0.3" }),
    resolveTypeScript6: () => ({ path: "/g/typescript/lib/tsserver.js", version: "6.0.3", source: "global" }),
    globalTypeScriptDirs: () => [],
    ...overrides,
  }
}

const statusOf = (reports: Awaited<ReturnType<typeof checkExternalTools>>) => Object.fromEntries(reports.map((report) => [report.tool.id, report.status]))

describe("external tools check", () => {
  test("#given marker files #then the project's languages are detected", () => {
    expect([...projectLanguages(project("package.json", "pyproject.toml"))].sort()).toEqual(["python", "typescript"])
    expect([...projectLanguages(project("go.mod"))]).toEqual(["go"])
  })

  test("#given a TypeScript project with everything working #then only its tools are checked and all connect", async () => {
    const reports = await checkExternalTools(project("package.json"), deps(), { includeOptional: false })
    expect(statusOf(reports)).toEqual({ "typescript-language-server": "connects", git: "connects" })
  })

  test("#given the TypeScript server is not installed #then it is reported missing", async () => {
    const reports = await checkExternalTools(project("package.json"), deps({ which: (command) => (command === "git" ? "/usr/bin/git" : null) }), { includeOptional: false })
    expect(statusOf(reports)["typescript-language-server"]).toBe("missing")
  })

  test("#given only TypeScript 7 #then the server fails with the reason, without starting it", async () => {
    let probed = false
    const reports = await checkExternalTools(
      project("tsconfig.json"),
      deps({ resolveTypeScript6: () => ({ reason: "only TypeScript 7.0.2 found, which has no tsserver.js; install typescript@6" }), probe: async () => ((probed = true), { status: "connects", ms: 1 }) }),
      { includeOptional: false },
    )
    const report = reports.find((entry) => entry.tool.id === "typescript-language-server")
    expect(report?.status).toBe("fails")
    expect(report?.detail).toContain("install typescript@6")
    expect(probed).toBe(false)
  })

  test("#given a server that does not answer the handshake #then it fails, not connects", async () => {
    const reports = await checkExternalTools(project("package.json"), deps({ probe: async () => ({ status: "fails", ms: 20000, detail: "initialize timed out" }) }), { includeOptional: false })
    expect(statusOf(reports)["typescript-language-server"]).toBe("fails")
  })

  test("#given the first Python server is missing #then the second one is tried", async () => {
    const reports = await checkExternalTools(project("pyproject.toml"), deps({ which: (command) => (command === "basedpyright-langserver" ? null : `/usr/bin/${command}`) }), { includeOptional: false })
    expect(reports.find((entry) => entry.tool.id === "python-language-server")?.detail).toContain("pyright-langserver")
  })

  test("#given optional tools are asked for #then ast-grep and tmux are checked too", async () => {
    const reports = await checkExternalTools(project(), deps({ run: async (argv) => (argv[0]?.endsWith("tmux") ? { exitCode: 1, firstLine: "" } : { exitCode: 0, firstLine: "v1" }) }), { includeOptional: true })
    expect(statusOf(reports)).toEqual({ git: "connects", "ast-grep": "connects", tmux: "fails" })
  })
})
