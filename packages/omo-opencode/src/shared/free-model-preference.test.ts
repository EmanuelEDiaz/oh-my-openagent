/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"

import { parseModelCatalog } from "../cli/config-models/model-catalog"
import { isPaidModel, paidModelCheck, setPreferFreeModels } from "./free-model-preference"

const CATALOG = parseModelCatalog(JSON.stringify({
  opencode: { models: {
    "claude-opus-5-5": { cost: { input: 4, output: 20 } },
    "big-pickle": { cost: { input: 0, output: 0 } },
    "mystery": {},
  } },
  openai: { models: { "gpt-5.5": { cost: { input: 1, output: 4 } } } },
}))

describe("free model preference (fork 0.5)", () => {
  afterEach(() => setPreferFreeModels(false))

  test("is inactive by default: nothing is paid and resolvers get no check", () => {
    expect(isPaidModel("opencode/claude-opus-5-5")).toBe(false)
    expect(paidModelCheck()).toBeUndefined()
  })

  test("when enabled, only models with a non-zero price in the cache are paid", () => {
    // given
    setPreferFreeModels(true, () => CATALOG)

    // then
    expect(isPaidModel("opencode/claude-opus-5-5")).toBe(true)
    expect(isPaidModel("opencode/big-pickle")).toBe(false)
    expect(isPaidModel("opencode/mystery")).toBe(false)
    expect(isPaidModel("ollama/qwen3:8b")).toBe(false)
    expect(isPaidModel("opencode/anything-free")).toBe(false)
    expect(paidModelCheck()).toBe(isPaidModel)
  })

  test("a model missing from the cache is paid only if its provider offers no free model", () => {
    // given
    setPreferFreeModels(true, () => CATALOG)

    // then
    expect(isPaidModel("openai/gpt-6-luna-fast")).toBe(true)
    expect(isPaidModel("opencode/brand-new-model")).toBe(false)
    expect(isPaidModel("ollama/llama3.3")).toBe(false)
  })
})
