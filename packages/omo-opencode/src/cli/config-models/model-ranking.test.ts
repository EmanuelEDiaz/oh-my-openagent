/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { describeModelShort, parseModelCatalog } from "./model-catalog"
import { rankModels, recommendedRankFor } from "./model-ranking"

const NOW = new Date("2026-09-27T00:00:00Z")

const CATALOG = parseModelCatalog(JSON.stringify({
  opencode: {
    models: {
      "big-pickle": {
        name: "Big Pickle",
        description: "Reasoning model",
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text"] },
        limit: { context: 200_000 },
        cost: { input: 0, output: 0 },
        release_date: "2025-10-17",
      },
      "vision-free": {
        name: "Vision",
        reasoning: false,
        tool_call: true,
        modalities: { input: ["text", "image"] },
        limit: { context: 1_000_000 },
        cost: { input: 0, output: 0 },
        release_date: "2026-09-01",
      },
      "chatty": {
        name: "Chatty",
        reasoning: true,
        tool_call: false,
        modalities: { input: ["text", "image"] },
        limit: { context: 1_000_000 },
        cost: { input: 0, output: 0 },
        release_date: "2026-09-01",
      },
    },
  },
  openrouter: {
    models: {
      "openai/gpt-5.6-sol": {
        name: "GPT-5.6 Sol",
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"] },
        limit: { context: 1_100_000 },
        cost: { input: 2, output: 10 },
        release_date: "2026-07-01",
      },
    },
  },
}))

describe("parseModelCatalog", () => {
  test("keys models by provider/modelId even when the modelId contains a slash", () => {
    // when
    const info = CATALOG.get("openrouter/openai/gpt-5.6-sol")

    // then
    expect(info?.contextTokens).toBe(1_100_000)
    expect(describeModelShort(info)).toBe("1.1M ctx · text+img+pdf · reasoning · tools · $2/$10 per 1M · 2026-07")
  })
})

describe("rankModels", () => {
  const models = ["opencode/big-pickle", "opencode/vision-free", "opencode/chatty", "openrouter/openai/gpt-5.6-sol", "x/unknown"]

  test("#given multimodal-looker #then text-only models get an image warning and rank below vision models", () => {
    // when
    const ranked = rankModels("multimodal-looker", models, CATALOG, NOW)

    // then
    const pickle = ranked.find((entry) => entry.model === "opencode/big-pickle")
    expect(pickle?.warnings).toContain("no image input")
    expect(ranked.findIndex((entry) => entry.model === "opencode/vision-free"))
      .toBeLessThan(ranked.findIndex((entry) => entry.model === "opencode/big-pickle"))
  })

  test("#given any agent #then models without tool calling are heavily penalized", () => {
    // when
    const ranked = rankModels("explore", models, CATALOG, NOW)

    // then
    const chatty = ranked.find((entry) => entry.model === "opencode/chatty")
    expect(chatty?.warnings).toContain("no tool calling: agents cannot use tools")
    expect(chatty?.score).toBeLessThan(40)
  })

  test("#given oracle #then the plugin's recommended high-reasoning model ranks first", () => {
    // when
    const ranked = rankModels("oracle", models, CATALOG, NOW)

    // then
    expect(ranked[0]?.model).toBe("openrouter/openai/gpt-5.6-sol")
    expect(ranked[0]?.recommendedRank).toBe(0)
  })

  test("#given a model missing from the catalog #then it is kept and flagged", () => {
    // when
    const unknown = rankModels("explore", models, CATALOG, NOW).find((entry) => entry.model === "x/unknown")

    // then
    expect(unknown?.warnings).toEqual(["no metadata in models.dev cache"])
  })
})

describe("recommendedRankFor", () => {
  test("strips free suffixes and matches the plugin chain", () => {
    // then
    expect(recommendedRankFor("sisyphus", "opencode/big-pickle")).toBe(4)
    expect(recommendedRankFor("sisyphus", "opencode/unrelated")).toBeUndefined()
  })
})
