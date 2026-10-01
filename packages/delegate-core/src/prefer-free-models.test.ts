import { describe, expect, test } from "bun:test"

import { resolveModelForDelegateTask, type DelegateModelResolutionDeps } from "./model-selection"

const PAID = new Set(["opencode/claude-opus-5-5", "openai/gpt-6-luna-fast"])
const deps: DelegateModelResolutionDeps = {
  connectedProviders: null,
  hasProviderModelsCache: true,
  hasConnectedProvidersCache: true,
  isPaidModel: (model) => PAID.has(model),
}
const available = new Set(["opencode/claude-opus-5-5", "openai/gpt-6-luna-fast", "opencode/big-pickle"])

describe("prefer free models for delegated tasks (fork 0.5)", () => {
  test("a paid builtin category default is skipped in favour of a free chain model", () => {
    // when
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: "openai/gpt-6-luna-fast",
      fallbackChain: [{ providers: ["openai"], model: "gpt-6-luna-fast" }, { providers: ["opencode"], model: "big-pickle" }],
      availableModels: available,
    }, deps)

    // then
    expect(result).toMatchObject({ model: "opencode/big-pickle" })
  })

  test("a category model the user configured is kept even when paid", () => {
    // when
    const result = resolveModelForDelegateTask({
      categoryDefaultModel: "openai/gpt-6-luna-fast",
      isUserConfiguredCategoryModel: true,
      availableModels: available,
    }, deps)

    // then
    expect(result).toEqual({ model: "openai/gpt-6-luna-fast" })
  })

  test("the user's own model is kept even when paid", () => {
    // when
    const result = resolveModelForDelegateTask({ userModel: "opencode/claude-opus-5-5", availableModels: available }, deps)

    // then
    expect(result).toMatchObject({ model: "opencode/claude-opus-5-5" })
  })

  test("cross-provider matches in the chain skip paid models too", () => {
    // when
    const result = resolveModelForDelegateTask({
      fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-5-5" }, { providers: ["opencode"], model: "big-pickle" }],
      availableModels: available,
    }, deps)

    // then
    expect(result).toMatchObject({ model: "opencode/big-pickle" })
  })
})
