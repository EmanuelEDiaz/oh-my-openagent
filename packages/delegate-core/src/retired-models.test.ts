import { describe, expect, test } from "bun:test"

import { resolveModelForDelegateTask, type DelegateModelResolutionDeps } from "./model-selection"

const deps: DelegateModelResolutionDeps = { connectedProviders: null, hasProviderModelsCache: true, hasConnectedProvidersCache: true }
const available = new Set(["opencode/big-pickle", "opencode/nemotron-3.5-lightning-free"])

describe("delegating to an agent whose configured model was retired (fork 0.7)", () => {
  test("without fallback_models, the registered agent model is used instead of the retired one", () => {
    // when
    const result = resolveModelForDelegateTask({
      userModel: "opencode/deepseek-v4-flash-free",
      categoryDefaultModel: "opencode/big-pickle",
      availableModels: available,
    }, deps)

    // then
    expect(result).toMatchObject({ model: "opencode/big-pickle" })
  })

  test("with nothing usable it returns nothing, so the task runs on the session model instead of failing", () => {
    // when
    const result = resolveModelForDelegateTask({
      userModel: "opencode/deepseek-v4-flash-free",
      userFallbackModels: ["opencode/north-mini-code-free"],
      availableModels: available,
    }, deps)

    // then
    expect(result).toBeUndefined()
  })

  test("an unknown model list keeps the user's model as before", () => {
    // when
    const result = resolveModelForDelegateTask({
      userModel: "opencode/deepseek-v4-flash-free",
      availableModels: new Set(),
    }, deps)

    // then
    expect(result).toMatchObject({ model: "opencode/deepseek-v4-flash-free" })
  })
})
