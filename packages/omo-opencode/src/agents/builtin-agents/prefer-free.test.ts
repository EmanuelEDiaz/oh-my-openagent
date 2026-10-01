/// <reference types="bun-types" />

import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { parseModelCatalog } from "../../cli/config-models/model-catalog"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { setPreferFreeModels } from "../../shared/free-model-preference"
import * as shared from "../../shared"
import { createBuiltinAgents } from "../builtin-agents"

const MODELS = ["opencode/claude-opus-5-5", "opencode/claude-sonnet-5", "opencode/big-pickle", "openai/gpt-6-luna-fast"]
const CATALOG = parseModelCatalog(JSON.stringify({
  opencode: { models: {
    "claude-opus-5-5": { cost: { input: 4, output: 20 } },
    "claude-sonnet-5": { cost: { input: 2, output: 10 } },
    "big-pickle": { cost: { input: 0, output: 0 } },
  } },
  openai: { models: { "gpt-6-luna-fast": { cost: { input: 0.2, output: 1 } } } },
}))

describe("prefer free models for automatic agent picks (fork 0.5)", () => {
  let spies: { mockRestore: () => void }[] = []

  function zenAccount(): void {
    spies = [
      spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode", "openai"]),
      spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null),
      spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(MODELS)),
    ]
  }

  afterEach(() => {
    spies.forEach((spy) => spy.mockRestore())
    setPreferFreeModels(false)
  })

  test("with the preference on, orchestrators get the free model instead of paid Zen models", async () => {
    // given
    zenAccount()
    setPreferFreeModels(true, () => CATALOG)

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.sisyphus?.model).toBe("opencode/big-pickle")
    expect(agents.atlas?.model).toBe("opencode/big-pickle")
    expect(agents.explore?.model).not.toBe("openai/gpt-6-luna-fast")
  })

  test("a model chosen by the user (as /omo-models writes it) is kept even when paid", async () => {
    // given
    zenAccount()
    setPreferFreeModels(true, () => CATALOG)

    // when
    const agents = await createBuiltinAgents([], { atlas: { model: "opencode/claude-sonnet-5" } }, undefined, undefined)

    // then
    expect(agents.atlas?.model).toBe("opencode/claude-sonnet-5")
  })

  test("with the preference off, behaviour is unchanged", async () => {
    // given
    zenAccount()

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.sisyphus?.model).toBe("opencode/claude-opus-5-5")
  })
})
