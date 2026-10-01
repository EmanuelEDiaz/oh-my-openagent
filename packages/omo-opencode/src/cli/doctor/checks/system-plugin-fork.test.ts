/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { findPluginEntry } from "./system-plugin"

describe("doctor recognises a forked checkout loaded from file:// (fork 0.6)", () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))

  function checkout(packageName: string): string {
    const root = mkdtempSync(join(tmpdir(), "omo-doctor-fork-"))
    dirs.push(root)
    mkdirSync(join(root, "repo", "dist"), { recursive: true })
    writeFileSync(join(root, "repo", "package.json"), JSON.stringify({ name: packageName }))
    writeFileSync(join(root, "repo", "dist", "index.js"), "")
    symlinkSync(join(root, "repo"), join(root, "omo-fork"))
    return root
  }

  it("a file:// entry whose path has another name but resolves to the plugin package counts as local dev", () => {
    // given
    const root = checkout("oh-my-openagent")

    // when
    const found = findPluginEntry([`file://${join(root, "omo-fork", "dist", "index.js")}`])

    // then
    expect(found?.isLocalDev).toBe(true)
  })

  it("an unrelated file:// plugin is not mistaken for this plugin", () => {
    // given
    const root = checkout("some-other-plugin")

    // then
    expect(findPluginEntry([`file://${join(root, "omo-fork", "dist", "index.js")}`])).toBeNull()
  })
})
