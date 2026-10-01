import { describe, expect, test } from "bun:test"

import { isKnownMissingModel, withoutKnownMissingModels } from "./model-availability"
import { resolveModelPipeline } from "./model-resolution-pipeline"

const AVAILABLE = new Set(["opencode/big-pickle", "opencode/nemotron-3.5-lightning-free"])

describe("isKnownMissingModel (fork 0.7)", () => {
  test("a model whose provider list we hold and that is not in it is known missing", () => {
    expect(isKnownMissingModel("opencode/deepseek-v4-flash-free", AVAILABLE)).toBe(true)
  })

  test("listed models, unknown providers, an empty list and bare ids are never treated as missing", () => {
    expect(isKnownMissingModel("opencode/big-pickle", AVAILABLE)).toBe(false)
    expect(isKnownMissingModel("ollama/qwen3:8b", AVAILABLE)).toBe(false)
    expect(isKnownMissingModel("opencode/deepseek-v4-flash-free", new Set())).toBe(false)
    expect(isKnownMissingModel("big-pickle-retired", AVAILABLE)).toBe(false)
  })

  test("withoutKnownMissingModels keeps order and drops only the known missing", () => {
    expect(withoutKnownMissingModels(["opencode/retired", "ollama/x", "opencode/big-pickle"], AVAILABLE)).toEqual(["ollama/x", "opencode/big-pickle"])
  })
})

describe("a configured model its provider no longer offers is replaced, even without fallback_models (fork 0.7)", () => {
  test("falls through to the automatic chain and records the retired model as attempted", () => {
    // when
    const result = resolveModelPipeline({
      intent: { userModel: "opencode/deepseek-v4-flash-free" },
      constraints: { availableModels: AVAILABLE },
      policy: { fallbackChain: [{ providers: ["opencode"], model: "big-pickle" }] },
    })

    // then
    expect(result?.model).toBe("opencode/big-pickle")
    expect(result?.attempted).toContain("opencode/deepseek-v4-flash-free")
  })

  test("with nothing else available it returns nothing instead of the retired model", () => {
    // when
    const result = resolveModelPipeline({
      intent: { userModel: "opencode/deepseek-v4-flash-free" },
      constraints: { availableModels: AVAILABLE },
    })

    // then
    expect(result).toBeUndefined()
  })
})
