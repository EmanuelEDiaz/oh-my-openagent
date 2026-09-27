/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseModelCatalog } from "./model-catalog"
import { filterBySource, isFreeModel } from "./model-sources"
import { buildPreset } from "./presets"

const CATALOG = parseModelCatalog(JSON.stringify({
  opencode: { models: { "big-pickle": { tool_call: true, cost: { input: 0, output: 0 } }, "gpt-5.6-sol": { tool_call: true, cost: { input: 4, output: 20 } } } },
}))
const AVAILABLE = ["opencode/big-pickle", "opencode/gpt-5.6-sol", "opencode/nemotron-free", "openrouter/qwen/qwen3:free", "ollama/qwen3.5:4b"]

describe("model sources", () => {
  test("free = $0 in catalog, -free/:free ids, or local", () => {
    // then
    expect(filterBySource(AVAILABLE, "free", CATALOG)).toEqual([
      "opencode/big-pickle",
      "opencode/nemotron-free",
      "openrouter/qwen/qwen3:free",
      "ollama/qwen3.5:4b",
    ])
    expect(filterBySource(AVAILABLE, "local", CATALOG)).toEqual(["ollama/qwen3.5:4b"])
    expect(isFreeModel("opencode/gpt-5.6-sol", CATALOG)).toBe(false)
  })
})

describe("buildPreset", () => {
  test("free: cloud free models only, never paid", () => {
    // when
    const chains = buildPreset({ preset: "free", agents: ["oracle"], available: AVAILABLE, catalog: CATALOG })

    // then
    const chain = chains.get("oracle") ?? []
    expect(chain.length).toBe(3)
    expect(chain).not.toContain("opencode/gpt-5.6-sol")
    expect(chain).not.toContain("ollama/qwen3.5:4b")
  })

  test("local: only local models; agents are skipped when there are none", () => {
    // when
    const withLocal = buildPreset({ preset: "local", agents: ["explore"], available: AVAILABLE, catalog: CATALOG })
    const withoutLocal = buildPreset({ preset: "local", agents: ["explore"], available: ["opencode/big-pickle"], catalog: CATALOG })

    // then
    expect(withLocal.get("explore")).toEqual(["ollama/qwen3.5:4b"])
    expect(withoutLocal.size).toBe(0)
  })

  test("mixed: explore starts local, others end with the local model as last resort", () => {
    // when
    const chains = buildPreset({ preset: "mixed", agents: ["explore", "oracle"], available: AVAILABLE, catalog: CATALOG })

    // then
    expect(chains.get("explore")?.[0]).toBe("ollama/qwen3.5:4b")
    expect(chains.get("oracle")?.at(-1)).toBe("ollama/qwen3.5:4b")
    expect(chains.get("oracle")?.[0]).not.toBe("ollama/qwen3.5:4b")
  })
})

describe("buildPreset primary spreading", () => {
  test("similar free models are spread as primaries across agents", () => {
    // given
    const catalog = parseModelCatalog(JSON.stringify({
      opencode: {
        models: Object.fromEntries(["a-free", "b-free", "c-free"].map((id) => [id, {
          reasoning: true, tool_call: true, limit: { context: 1_000_000 }, cost: { input: 0, output: 0 }, release_date: "2026-09-01",
        }])),
      },
    }))

    // when
    const chains = buildPreset({
      preset: "free",
      agents: ["sisyphus", "prometheus", "metis"],
      available: ["opencode/a-free", "opencode/b-free", "opencode/c-free"],
      catalog,
    })

    // then
    const primaries = new Set([...chains.values()].map((chain) => chain[0]))
    expect(primaries.size).toBe(3)
    for (const chain of chains.values()) expect(new Set(chain).size).toBe(chain.length)
  })
})
