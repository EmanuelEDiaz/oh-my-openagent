import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { watchMirror } from "../../tui"
import { writeMirror } from "./mirror-io"
import { mirrorFilePath } from "./mirror-path"

const original = process.env.XDG_DATA_HOME
let root = ""
afterEach(() => {
  process.env.XDG_DATA_HOME = original
  if (root) rmSync(root, { recursive: true, force: true })
})

describe("sidebar refresh without polling (04-10-2026)", () => {
  test("a write of the server's state file notifies the panel", async () => {
    root = mkdtempSync(join(tmpdir(), "watch-mirror-"))
    process.env.XDG_DATA_HOME = root
    const project = join(root, "project")
    mkdirSync(project)
    mkdirSync(dirname(mirrorFilePath(project)), { recursive: true })
    let changes = 0
    const watcher = watchMirror(project, () => { changes++ })
    expect(watcher).toBeDefined()
    writeMirror(project, { version: 1, projectDir: project, updatedAt: Date.now(), activeAgents: [], jobBoard: [], loop: null })
    await new Promise((resolve) => setTimeout(resolve, 300))
    watcher?.close()
    expect(changes).toBeGreaterThan(0)
  })
})
