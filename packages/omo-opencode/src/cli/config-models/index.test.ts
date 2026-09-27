/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseJsonc } from "../../shared"
import { runConfigModels } from "."
import type { ConfigModelsOptions, ConfigModelsPrompts } from "."
import type { MenuAction } from "./prompts"

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
      seedCache: () => 0,
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
    function scriptedPrompts(overrides: Partial<ConfigModelsPrompts>, log: string[]): ConfigModelsPrompts {
      const menu: MenuAction[] = ["one", "save"]
      return {
        promptMainMenu: async ({ pending }) => {
          log.push(`menu:pending=${pending.size}`)
          return menu.shift() ?? "exit"
        },
        promptAgent: async ({ statuses }) => {
          log.push(`agents:${statuses.map((status) => status.agent).join(",")}`)
          return "explore"
        },
        promptMode: async () => "guided",
        promptChain: async ({ current, mode }) => {
          log.push(`current:${current.join(",")}:${mode}`)
          return ["opencode/north-mini-code-free", "opencode/big-pickle"]
        },
        showSuggestedFixes: (summary) => {
          log.push(`fixes:${summary}`)
        },
        promptAcceptFixes: async () => true,
        promptEnableRuntimeFallback: async () => false,
        promptConfirmWrite: async (summary) => {
          log.push(`confirm:${summary}`)
          return true
        },
        ...overrides,
      }
    }

    test("#when the user configures one agent and saves #then the chosen chain is written", async () => {
      // given
      writeUserConfig(home, { agents: { explore: { model: "opencode/big-pickle" } } })
      const log: string[] = []

      // when
      const exitCode = await run({ isInteractive: () => true, prompts: scriptedPrompts({}, log) })

      // then
      expect(exitCode).toBe(0)
      expect(log).toContain("current:opencode/big-pickle:guided")
      expect(log.find((entry) => entry.startsWith("agents:"))).not.toContain("build")
      expect(log).toContain("menu:pending=1")
      const openCode = readOpenCode(join(home, ".omo", "omo.jsonc"))
      expect(openCode["agents"]).toMatchObject({
        explore: { models: ["opencode/north-mini-code-free", "opencode/big-pickle"] },
      })
      expect(openCode["runtime_fallback"]).toBeUndefined()
    })

    test("#when fixing broken agents #then only agents with missing models get suggested chains", async () => {
      // given
      writeUserConfig(home, {
        agents: {
          explore: { model: "opencode/retired-free" },
          oracle: { model: "opencode/big-pickle" },
        },
      })
      const log: string[] = []
      const menu: MenuAction[] = ["fix-broken", "save"]

      // when
      const exitCode = await run({
        isInteractive: () => true,
        prompts: scriptedPrompts({ promptMainMenu: async () => menu.shift() ?? "exit" }, log),
      })

      // then
      expect(exitCode).toBe(0)
      const fixes = log.find((entry) => entry.startsWith("fixes:")) ?? ""
      expect(fixes).toContain("explore")
      expect(fixes).not.toContain("oracle")
      const agents = readOpenCode(join(home, ".omo", "omo.jsonc"))["agents"] as Record<string, Record<string, unknown>>
      expect(agents["explore"]?.["models"]).toBeDefined()
      expect(agents["oracle"]).toEqual({ model: "opencode/big-pickle" })
    })

    test("#when the user declines the final confirmation #then nothing is written", async () => {
      // given
      const path = writeUserConfig(home, { agents: {} })
      const before = readFileSync(path, "utf-8")

      // when
      const exitCode = await run({
        isInteractive: () => true,
        prompts: scriptedPrompts({ promptConfirmWrite: async () => false }, []),
      })

      // then
      expect(exitCode).toBe(1)
      expect(readFileSync(path, "utf-8")).toBe(before)
    })

    test("#given a live model list #then the plugin cache is seeded with it", async () => {
      // given
      const seeded: string[][] = []

      // when
      await run({ check: true, seedCache: (models) => {
        seeded.push([...models])
        return 1
      } })

      // then
      expect(seeded).toEqual([AVAILABLE])
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
