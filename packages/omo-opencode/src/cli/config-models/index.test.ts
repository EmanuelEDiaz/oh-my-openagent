/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "../../shared"
import { runConfigModels } from "."
import type { ConfigModelsOptions, ConfigModelsPrompts } from "."

const AVAILABLE = ["opencode/big-pickle", "opencode/deepseek-v4-flash", "opencode/north-mini-code-free"]

function writeUserConfig(home: string, openCode: Record<string, unknown>): string {
  const path = join(home, ".omo", "omo.jsonc")
  mkdirSync(join(home, ".omo"), { recursive: true })
  writeFileSync(path, `{\n  // user comment\n  "[opencode]": ${JSON.stringify(openCode)}\n}\n`)
  return path
}

function readOpenCode(path: string): Record<string, unknown> {
  return parseJsonc<Record<string, Record<string, unknown>>>(readFileSync(path, "utf-8"))["[opencode]"] ?? {}
}

describe("runConfigModels", () => {
  let home: string
  let lines: string[]

  function run(options: ConfigModelsOptions): Promise<number> {
    return runConfigModels({
      env: { HOME: home },
      cwd: home,
      output: (line) => lines.push(line),
      listModels: () => ({ models: AVAILABLE, source: "opencode-cli" }),
      ...options,
    })
  }

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "omo-config-models-"))
    lines = []
  })

  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  describe("#given a sisyphus chain whose primary model was retired", () => {
    beforeEach(() => {
      writeUserConfig(home, {
        agents: {
          sisyphus: { model: "opencode/deepseek-v4-flash-free", fallback_models: [{ model: "opencode/big-pickle" }] },
          oracle: { models: ["opencode/gone-1", "opencode/gone-2"] },
        },
      })
    })

    test("#when --check #then flags the missing primary and the fully broken chain", async () => {
      // when
      const exitCode = await run({ check: true })

      // then
      expect(exitCode).toBe(1)
      expect(lines).toContain("  [WARN] sisyphus: opencode/deepseek-v4-flash-free (missing) -> opencode/big-pickle")
      expect(lines).toContain("  [BROKEN] oracle: opencode/gone-1 (missing) -> opencode/gone-2 (missing)")
      expect(lines).toContain("runtime_fallback: disabled")
    })

    test("#when --agent/--models #then writes an ordered chain, keeps entry settings and drops legacy keys", async () => {
      // when
      const exitCode = await run({
        agent: "sisyphus",
        models: ["opencode/deepseek-v4-flash", "opencode/big-pickle"],
        enableRuntimeFallback: true,
      })

      // then
      expect(exitCode).toBe(0)
      const path = join(home, ".omo", "omo.jsonc")
      const openCode = readOpenCode(path)
      expect(openCode["agents"]).toMatchObject({
        sisyphus: { models: ["opencode/deepseek-v4-flash", { model: "opencode/big-pickle" }] },
      })
      const sisyphus = (openCode["agents"] as Record<string, Record<string, unknown>>)["sisyphus"] ?? {}
      expect(sisyphus["model"]).toBeUndefined()
      expect(sisyphus["fallback_models"]).toBeUndefined()
      expect(openCode["runtime_fallback"]).toBe(true)
      expect(readFileSync(path, "utf-8")).toContain("// user comment")
    })

    test("#when a model is not available #then refuses to write unless allowed", async () => {
      // when
      const refused = await run({ agent: "explore", models: ["opencode/not-real"] })
      const allowed = await run({ agent: "explore", models: ["opencode/not-real"], allowUnavailable: true })

      // then
      expect(refused).toBe(1)
      expect(allowed).toBe(0)
      expect(readOpenCode(join(home, ".omo", "omo.jsonc"))["agents"]).toMatchObject({
        explore: { models: ["opencode/not-real"] },
      })
    })
  })

  describe("#given the interactive picker", () => {
    test("#when the user selects and orders models #then the chosen order is written", async () => {
      // given
      writeUserConfig(home, { agents: { explore: { model: "opencode/big-pickle" } } })
      const asked: string[] = []
      const prompts: ConfigModelsPrompts = {
        promptAgents: async (statuses) => {
          asked.push(`agents:${statuses.length}`)
          return ["explore"]
        },
        promptModels: async ({ current }) => {
          asked.push(`current:${current.join(",")}`)
          return ["opencode/big-pickle", "opencode/north-mini-code-free"]
        },
        promptOrder: async ({ selected }) => [...selected].reverse(),
        promptEnableRuntimeFallback: async () => false,
      }

      // when
      const exitCode = await run({ isInteractive: () => true, prompts })

      // then
      expect(exitCode).toBe(0)
      expect(asked).toContain("current:opencode/big-pickle")
      const openCode = readOpenCode(join(home, ".omo", "omo.jsonc"))
      expect(openCode["agents"]).toMatchObject({
        explore: { models: ["opencode/north-mini-code-free", "opencode/big-pickle"] },
      })
      expect(openCode["runtime_fallback"]).toBeUndefined()
    })

    test("#when the user cancels #then nothing is written", async () => {
      // given
      const path = writeUserConfig(home, { agents: {} })
      const before = readFileSync(path, "utf-8")
      const prompts: ConfigModelsPrompts = {
        promptAgents: async () => null,
        promptModels: async () => null,
        promptOrder: async () => null,
        promptEnableRuntimeFallback: async () => null,
      }

      // when
      const exitCode = await run({ isInteractive: () => true, prompts })

      // then
      expect(exitCode).toBe(1)
      expect(readFileSync(path, "utf-8")).toBe(before)
    })

    test("#when there is no TTY #then it explains the non-interactive flags", async () => {
      // when
      const exitCode = await run({ isInteractive: () => false })

      // then
      expect(exitCode).toBe(1)
      expect(lines.at(-1)).toContain("--agent <name> --models")
    })
  })
})
