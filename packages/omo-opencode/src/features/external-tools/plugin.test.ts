import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CheckDeps } from "./check"
import { runExternalToolsNotice } from "./plugin"

function typescriptProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-notice-"))
  writeFileSync(join(dir, "package.json"), "{}")
  return dir
}

function deps(overrides: Partial<CheckDeps> = {}): CheckDeps & { probes: number } {
  const state = { probes: 0 }
  return Object.assign(state, {
    which: (command: string) => `/usr/bin/${command}`,
    run: async () => ({ exitCode: 0, firstLine: "v1" }),
    probe: async () => ((state.probes += 1), { status: "connects" as const, ms: 5 }),
    resolveTypeScript6: () => ({ path: "/g/tsserver.js", version: "6.0.3", source: "global" as const }),
    globalTypeScriptDirs: () => [],
    ...overrides,
  })
}

function client() {
  const toasts: string[] = []
  return { toasts, tui: { showToast: async (input: { body: { message: string } }) => void toasts.push(input.body.message) } }
}

describe("external tools startup notice", () => {
  test("#given everything connects #then no toast is shown", async () => {
    const tui = client()
    const cacheFile = join(mkdtempSync(join(tmpdir(), "omo-notice-cache-")), "c.json")
    expect(await runExternalToolsNotice({ directory: typescriptProject(), client: tui, deps: deps(), cacheFile })).toBeUndefined()
    expect(tui.toasts).toEqual([])
  })

  test("#given the TypeScript server is missing #then a toast says so", async () => {
    const tui = client()
    const cacheFile = join(mkdtempSync(join(tmpdir(), "omo-notice-cache-")), "c.json")
    await runExternalToolsNotice({ directory: typescriptProject(), client: tui, deps: deps({ which: (command) => (command === "git" ? "/usr/bin/git" : null) }), cacheFile })
    expect(tui.toasts[0]).toContain("TypeScript language server")
    expect(tui.toasts[0]).toContain("no está instalado")
  })

  test("#given a second start with the same binaries #then the cached result is used and no server is started again", async () => {
    const project = typescriptProject()
    const cacheFile = join(mkdtempSync(join(tmpdir(), "omo-notice-cache-")), "c.json")
    const first = deps()
    await runExternalToolsNotice({ directory: project, client: client(), deps: first, cacheFile })
    const second = deps()
    await runExternalToolsNotice({ directory: project, client: client(), deps: second, cacheFile })
    expect(first.probes).toBe(1)
    expect(second.probes).toBe(0)
  })
})
