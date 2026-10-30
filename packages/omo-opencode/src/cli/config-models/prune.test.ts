/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "../../shared"
import { runConfigModels } from "."

// Fork plan real-use-incidents A4: clean dead models out of ~/.omo/omo.jsonc, keeping a backup.
describe("config models --prune", () => {
  let home: string
  let lines: string[]

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omo-config-prune-"))
    lines = []
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  test("removes retired and not-served models, empties dead chains and backs the file up", async () => {
    // given
    const path = join(home, ".omo", "omo.jsonc")
    mkdirSync(join(home, ".omo"), { recursive: true })
    writeFileSync(path, JSON.stringify({
      "[opencode]": {
        agents: {
          librarian: { model: "opencode/deepseek-v4-flash-free", fallback_models: [{ model: "opencode/north-mini-code-free" }] },
          explore: { models: ["opencode/ling-3.0-flash-fin-free", "opencode/big-pickle"] },
          oracle: { models: ["opencode/big-pickle"] },
        },
      },
    }))

    // when
    const exitCode = await runConfigModels({
      prune: true,
      env: { HOME: home },
      cwd: home,
      output: (line) => lines.push(line),
      listModels: () => ({ models: ["opencode/big-pickle", "opencode/ling-3.0-flash-fin-free"], source: "opencode-cli" }),
      loadCatalog: () => new Map(),
      seedCache: () => 0,
      detectLocal: async () => ({ baseUrl: "http://ollama.test", reachable: false, models: [] }),
      openCodeConfigPath: join(home, "opencode.json"),
      notServed: () => new Set(["opencode/ling-3.0-flash-fin-free"]),
    })

    // then
    expect(exitCode).toBe(0)
    const agents = parseJsonc<Record<string, Record<string, Record<string, unknown>>>>(readFileSync(path, "utf-8"))["[opencode]"]?.["agents"]
    expect(agents?.["explore"]).toEqual({ models: ["opencode/big-pickle"] })
    expect(agents?.["oracle"]).toEqual({ models: ["opencode/big-pickle"] })
    expect(agents?.["librarian"]?.["models"]).toBeUndefined()
    expect(agents?.["librarian"]?.["model"]).toBeUndefined()
    expect(readdirSync(join(home, ".omo")).some((name) => name.startsWith("omo.jsonc.bak."))).toBe(true)
    expect(existsSync(path)).toBe(true)
  })
})
