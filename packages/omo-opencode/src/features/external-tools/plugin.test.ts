import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CheckDeps } from "./check"
import { createExternalToolsNotice, externalToolsNotice } from "./plugin"

function typescriptProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-notice-"))
  writeFileSync(join(dir, "package.json"), "{}")
  return dir
}

const cacheFile = () => join(mkdtempSync(join(tmpdir(), "omo-notice-cache-")), "c.json")

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

const noServer = () => deps({ which: (command) => (command === "git" ? "/usr/bin/git" : null) })

function client() {
  const toasts: string[] = []
  return { toasts, tui: { showToast: async (input: { body: { message: string } }) => void toasts.push(input.body.message) } }
}

describe("external tools startup notice", () => {
  test("#given everything connects #then there is no notice", async () => {
    expect(await externalToolsNotice({ directory: typescriptProject(), deps: deps(), cacheFile: cacheFile() })).toBeUndefined()
  })

  test("#given the TypeScript server is missing #then the notice names it", async () => {
    const notice = await externalToolsNotice({ directory: typescriptProject(), deps: noServer(), cacheFile: cacheFile() })
    expect(notice).toContain("TypeScript language server")
    expect(notice).toContain("no está instalado")
  })

  test("#given a second start with the same binaries #then the cached result is used and no server is started again", async () => {
    const project = typescriptProject()
    const file = cacheFile()
    const first = deps()
    await externalToolsNotice({ directory: project, deps: first, cacheFile: file })
    const second = deps()
    await externalToolsNotice({ directory: project, deps: second, cacheFile: file })
    expect(first.probes).toBe(1)
    expect(second.probes).toBe(0)
  })

  // QA 21-10-2026: a toast sent 4 s after load, while OpenCode was still booting, never reached the TUI.
  test("#given a problem #when the TUI shows activity #then the toast goes out then, not before", async () => {
    const tui = client()
    const notice = createExternalToolsNotice(typescriptProject(), tui, { deps: noServer(), cacheFile: cacheFile(), checkDelayMs: 1, fallbackMs: 60_000 })
    await Bun.sleep(50)
    expect(tui.toasts).toEqual([])
    notice.onEvent({ type: "session.created" })
    await notice.done
    expect(tui.toasts).toHaveLength(1)
    notice.onEvent({ type: "message.updated" })
    expect(tui.toasts).toHaveLength(1)
  })

  test("#given a problem and no TUI activity #then the toast goes out at the fallback time", async () => {
    const tui = client()
    const notice = createExternalToolsNotice(typescriptProject(), tui, { deps: noServer(), cacheFile: cacheFile(), checkDelayMs: 1, fallbackMs: 30 })
    await notice.done
    expect(tui.toasts).toHaveLength(1)
  })

  test("#given the TUI was already active when the check ends #then the toast goes out at once", async () => {
    const tui = client()
    const notice = createExternalToolsNotice(typescriptProject(), tui, { deps: noServer(), cacheFile: cacheFile(), checkDelayMs: 20, fallbackMs: 60_000 })
    notice.onEvent({ type: "tui.prompt.append" })
    await notice.done
    expect(tui.toasts).toHaveLength(1)
  })

  test("#given unrelated events #then they do not release the notice", async () => {
    const tui = client()
    const notice = createExternalToolsNotice(typescriptProject(), tui, { deps: noServer(), cacheFile: cacheFile(), checkDelayMs: 1, fallbackMs: 60_000 })
    await Bun.sleep(50)
    notice.onEvent({ type: "file.watcher.updated" })
    notice.onEvent({ type: "lsp.client.diagnostics" })
    await Bun.sleep(20)
    expect(tui.toasts).toEqual([])
  })
})
