/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { parseModelCatalog } from "../../cli/config-models/model-catalog"
import { matchKey, parseArtificialAnalysis, parseOpenRouterEndpoints, parseOpenRouterModels } from "./external-data"
import { freeModelNotes } from "./free-model-notes"
import { collectFacts, detailRows, previewLine, wrapText } from "./model-facts"

const AA_PAYLOAD = {
  data: [{
    slug: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    evaluations: { artificial_analysis_intelligence_index: 51.2, artificial_analysis_coding_index: 44.8, artificial_analysis_agentic_index: 47 },
    performance: { median_output_tokens_per_second: 181.4, median_time_to_first_token_seconds: 0.72 },
  }],
}

const MODEL = {
  id: "deepseek-v4-flash",
  limit: { context: 1_000_000, output: 384_000 },
  cost: { input: 0.14, output: 0.28, cache: { read: 0.028 } },
  capabilities: { toolcall: true, reasoning: true, input: { text: true, image: false } },
  release_date: "2026-07-31",
}

describe("external data parsers", () => {
  test("Artificial Analysis rows are keyed by an exact normalized name", () => {
    // when
    const benchmarks = parseArtificialAnalysis(AA_PAYLOAD)

    // then
    expect(benchmarks[matchKey("opencode/deepseek-v4-flash")]?.codingIndex).toBe(44.8)
    expect(benchmarks[matchKey("opencode/deepseek-v4-pro")]).toBeUndefined()
    expect(matchKey("openrouter/nvidia/nemotron-3.5-lightning:free")).toBe(matchKey("opencode/nemotron-3.5-lightning-free"))
  })

  test("OpenRouter models and endpoints are parsed", () => {
    // when
    const models = parseOpenRouterModels({ data: [{ id: "qwen/qwen3:free", description: "Qwen 3", context_length: 262_144, supported_parameters: ["tools"] }] })
    const reliability = parseOpenRouterEndpoints({ data: { endpoints: [{ uptime_last_1d: 99.1 }, { uptime_last_1d: 99.93 }] } })

    // then
    expect(models["qwen/qwen3:free"]).toEqual({ description: "Qwen 3", contextLength: 262_144, supportsTools: true })
    expect(reliability).toEqual({ source: "OpenRouter", providers: 2, bestUptimeLastDay: 99.93 })
  })
})

describe("model facts", () => {
  const catalog = parseModelCatalog(JSON.stringify({
    opencode: { models: { "deepseek-v4-flash": { description: "Fast DeepSeek for agents", knowledge: "2025-05", open_weights: true } } },
  }))

  test("the list preview shows context, abilities and the coding index when known", () => {
    // when
    const facts = collectFacts({ provider: "opencode", model: MODEL, catalog, external: { fetchedAt: "", benchmarks: parseArtificialAnalysis(AA_PAYLOAD), openRouter: {} } })

    // then
    expect(previewLine(facts)).toBe("1M ctx · thinks · code 45")
  })

  test("the details screen attributes every fact and flags agent blockers", () => {
    // given
    const facts = collectFacts({ provider: "opencode", model: MODEL, catalog, external: { fetchedAt: "", benchmarks: parseArtificialAnalysis(AA_PAYLOAD), openRouter: {} } })

    // when
    const rows = detailRows("multimodal-looker", facts)

    // then
    const titles = rows.map((row) => row.title)
    expect(titles).toContain("⚠ No image input: this agent needs to see images")
    expect(rows).toContainEqual({ category: "What it is", title: "Fast DeepSeek for agents", footer: "models.dev" })
    expect(titles).toContain("Knowledge cutoff: 2025-05")
    expect(titles).toContain("Context window: 1M tokens")
    expect(titles).toContain("Max output: 384k tokens")
    expect(titles).toContain("Input $0.14 · Output $0.28")
    expect(titles).toContain("Coding index: 44.8 / 100")
    expect(titles).toContain("Speed: 181 tokens/s (median)")
    expect(rows.at(-1)?.title).toContain("artificialanalysis.ai")
  })

  test("without benchmark data the screen says so instead of guessing", () => {
    // when
    const rows = detailRows("explore", collectFacts({ provider: "opencode", model: MODEL, catalog: new Map(), external: undefined }))

    // then
    expect(rows.some((row) => row.title.startsWith("No exact match"))).toBe(true)
    expect(rows).toContainEqual({ category: "What it is", title: "No description published", footer: "" })
  })
})

describe("free tier notes", () => {
  test("OpenRouter :free limits and Zen data policies come with source and date", () => {
    // then
    expect(freeModelNotes("openrouter/qwen/qwen3:free")[0]?.text).toContain("50 requests/day")
    expect(freeModelNotes("opencode/space-bunny-free").map((note) => note.text)).toContain("Data: zero-retention provider; your data is not used for training.")
    expect(freeModelNotes("opencode/claude-opus-5")).toEqual([])
    expect(freeModelNotes("opencode/big-pickle")[0]?.source).toBe("https://opencode.ai/docs/zen/")
  })
})

describe("wrapText", () => {
  test("splits long facts into indented lines that fit the dialog", () => {
    // when
    const lines = wrapText("Reasoning model for deliberate analysis, multi-step problem solving, and tool use", 30)

    // then
    expect(lines).toEqual(["Reasoning model for deliberate", "  analysis, multi-step problem", "  solving, and tool use"])
    expect(lines.every((line) => line.length <= 30)).toBe(true)
  })
})
