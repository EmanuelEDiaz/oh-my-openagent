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
      loadCatalog: () => new Map(),
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
      expect(lines).toContain(`${"sisyphus".padEnd(19)}${"missing".padEnd(13)}opencode/deepseek-v4-flash-free (gone)  >  opencode/big-pickle`)
      expect(lines).toContain(`${"oracle".padEnd(19)}${"BROKEN".padEnd(13)}opencode/gone-1 (gone)  >  opencode/gone-2 (gone)`)
      expect(lines).toContain("Mid-session fallback (runtime_fallback): off")
      expect(lines.some((line) => line.startsWith("build "))).toBe(false)
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

  describe("#given an OpenCode native agent", () => {
    test("#when --agent build #then it is rejected as not an oh-my-openagent agent", async () => {
      // when
      const exitCode = await run({ agent: "build", models: ["opencode/big-pickle"] })

      // then
      expect(exitCode).toBe(1)
      expect(lines.at(-1)).toContain('unknown oh-my-openagent agent "build"')
    })
  })

  describe("#given disabled_providers in the config", () => {
    test("#when --rank #then models of disabled providers are not offered", async () => {
      // given
      writeUserConfig(home, { disabled_providers: ["openai"], agents: {} })

      // when
      const exitCode = await run({
        rank: "oracle",
        json: true,
        listModels: () => ({ models: ["openai/gpt-5.6-sol", "opencode/big-pickle"], source: "opencode-cli" }),
      })

      // then
      expect(exitCode).toBe(0)
      const report = JSON.parse(lines.join("\n")) as { ranking: { model: string }[] }
      expect(report.ranking.map((entry) => entry.model)).toEqual(["opencode/big-pickle"])
    })
  })

  describe("#given the interactive picker", () => {
    test("#when the user selects and orders models #then the chosen order is written", async () => {
      // given
      writeUserConfig(home, { agents: { explore: { model: "opencode/big-pickle" } } })
      const asked: string[] = []
      const prompts: ConfigModelsPrompts = {
        promptMode: async () => "guided",
        promptAgents: async (statuses) => {
          asked.push(`agents:${statuses.length}`)
          return ["explore"]
        },
        promptChain: async ({ current, mode }) => {
          asked.push(`current:${current.join(",")}:${mode}`)
          return ["opencode/north-mini-code-free", "opencode/big-pickle"]
        },
        promptEnableRuntimeFallback: async () => false,
        promptConfirmWrite: async (summary) => {
          asked.push(`confirm:${summary}`)
          return true
        },
      }

      // when
      const exitCode = await run({ isInteractive: () => true, prompts })

      // then
      expect(exitCode).toBe(0)
      expect(asked).toContain("current:opencode/big-pickle:guided")
      expect(asked).toContain("agents:11")
      expect(asked.some((entry) => entry.startsWith("confirm:explore"))).toBe(true)
      const openCode = readOpenCode(join(home, ".omo", "omo.jsonc"))
      expect(openCode["agents"]).toMatchObject({
        explore: { models: ["opencode/north-mini-code-free", "opencode/big-pickle"] },
      })
      expect(openCode["runtime_fallback"]).toBeUndefined()
    })

    test("#when the user declines the final confirmation #then nothing is written", async () => {
      // given
      const path = writeUserConfig(home, { agents: {} })
      const before = readFileSync(path, "utf-8")
      const prompts: ConfigModelsPrompts = {
        promptMode: async () => "recommended",
        promptAgents: async () => ["explore"],
        promptChain: async () => ["opencode/big-pickle"],
        promptEnableRuntimeFallback: async () => true,
        promptConfirmWrite: async () => false,
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
