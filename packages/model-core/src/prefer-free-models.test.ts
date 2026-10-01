import { describe, expect, test } from "bun:test"

import { resolveModelPipeline } from "./model-resolution-pipeline"

const PAID = new Set(["opencode/claude-opus-5-5", "opencode/claude-sonnet-5"])
const isPaidModel = (model: string) => PAID.has(model)
const chain = [
  { providers: ["opencode"], model: "claude-opus-5-5" },
  { providers: ["opencode"], model: "big-pickle" },
]

describe("prefer free models (fork 0.5)", () => {
  test("the automatic fallback chain skips paid models when a paid-model check is given", () => {
    // when
    const result = resolveModelPipeline({
      constraints: { availableModels: new Set(["opencode/claude-opus-5-5", "opencode/big-pickle"]) },
      policy: { fallbackChain: chain, isPaidModel },
    })

    // then
    expect(result?.model).toBe("opencode/big-pickle")
  })

  test("with only connected providers known, paid chain entries are skipped too", () => {
    // when
    const result = resolveModelPipeline({
      constraints: { availableModels: new Set(), connectedProviders: ["opencode"] },
      policy: { fallbackChain: chain, isPaidModel },
    })

    // then
    expect(result?.model).toBe("opencode/big-pickle")
  })

  test("the user's own choice always wins, even when paid", () => {
    // when
    const result = resolveModelPipeline({
      intent: { userModel: "opencode/claude-opus-5-5" },
      constraints: { availableModels: new Set(["opencode/claude-opus-5-5", "opencode/big-pickle"]) },
      policy: { fallbackChain: chain, isPaidModel },
    })

    // then
    expect(result?.model).toBe("opencode/claude-opus-5-5")
  })

  test("without the check nothing changes (upstream behaviour)", () => {
    // when
    const result = resolveModelPipeline({
      constraints: { availableModels: new Set(["opencode/claude-opus-5-5", "opencode/big-pickle"]) },
      policy: { fallbackChain: chain },
    })

    // then
    expect(result?.model).toBe("opencode/claude-opus-5-5")
  })

  test("when every chain model is paid, nothing is resolved from the chain", () => {
    // when
    const result = resolveModelPipeline({
      constraints: { availableModels: new Set(["opencode/claude-opus-5-5"]) },
      policy: { fallbackChain: [chain[0]!], isPaidModel },
    })

    // then
    expect(result).toBeUndefined()
  })
})
