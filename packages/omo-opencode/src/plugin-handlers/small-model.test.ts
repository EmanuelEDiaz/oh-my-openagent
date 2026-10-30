/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"

import { resetAgentRegistrationReport, takeAgentRegistrationIssues } from "../shared/agent-registration-report"
import type { ProviderModelsCache } from "../shared/connected-providers-cache"
import { applySmallModelDefault } from "./small-model"

// Real-use incident 07-10-2026 (fork plan real-use-incidents A5): titles ran on paid opencode/gpt-5.4-nano.
const free = (id: string) => ({ id, cost: { input: 0, output: 0 }, status: "active" })
const paid = (id: string) => ({ id, cost: { input: 0.2, output: 1.25 }, status: "active" })
const CACHE: ProviderModelsCache = {
  connected: ["openrouter", "opencode"],
  models: {
    openrouter: [free("qwen/qwen3-mini:free")],
    opencode: [paid("gpt-5.4-nano"), free("big-pickle"), free("ling-3.0-flash-fin-free"), { ...free("old-flash-free"), status: "deprecated" }, free("nemotron-3.5-lightning-free")],
  },
  updatedAt: "2026-10-07T00:00:00.000Z",
}

function run(config: Record<string, unknown>, options: { preferFree?: boolean; broken?: string[]; chains?: string[] } = {}) {
  applySmallModelDefault({
    config,
    preferFreeModels: options.preferFree ?? true,
    readCache: () => CACHE,
    brokenModels: () => new Set(options.broken ?? []),
    isPaid: (model) => model.endsWith("gpt-5.4-nano"),
    chainModels: () => options.chains ?? [],
  })
  return config
}

describe("small_model with prefer_free_models", () => {
  beforeEach(() => resetAgentRegistrationReport())

  test("unset: picks the first free, active, served small model on OpenCode Zen (never the paid nano)", () => {
    expect(run({}, { broken: ["opencode/ling-3.0-flash-fin-free"] }).small_model).toBe("opencode/nemotron-3.5-lightning-free")
  })

  test("unset and nothing small: any free served model, e.g. big-pickle", () => {
    expect(run({}, { broken: ["opencode/ling-3.0-flash-fin-free", "opencode/nemotron-3.5-lightning-free"] }).small_model).toBe("opencode/big-pickle")
  })

  test("an explicit small_model is never overridden; a paid one only gets a startup warning", () => {
    const config = run({ small_model: "opencode/gpt-5.4-nano" })
    expect(config.small_model).toBe("opencode/gpt-5.4-nano")
    expect(takeAgentRegistrationIssues()).toMatchObject([{ agent: "small_model", status: "notice" }])
  })

  test("prefer_free_models off: OpenCode's default is left alone", () => {
    expect(run({}, { preferFree: false }).small_model).toBeUndefined()
  })

  test("first start (nothing marked yet): a free model from the user's own chains wins over the cache order (QA 12-10-2026)", () => {
    // ling-3.0-flash-fin-free is listed by Zen but not served; the cache lists it before nemotron
    expect(run({}, { chains: ["opencode/big-pickle", "opencode/nemotron-3.5-lightning-free"] }).small_model).toBe("opencode/nemotron-3.5-lightning-free")
  })

  test("the user's chains only rank models the provider still offers for free", () => {
    expect(run({}, { chains: ["opencode/gpt-5.4-nano", "opencode/old-flash-free", "opencode/big-pickle"] }).small_model).toBe("opencode/big-pickle")
  })
})
