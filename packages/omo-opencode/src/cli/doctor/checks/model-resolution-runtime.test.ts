import { describe, expect, it } from "bun:test"

import { getModelResolutionInfoWithOverrides, SESSION_MODEL } from "./model-resolution"

const available = new Set(["opencode/big-pickle", "opencode/claude-opus-5-5"])
const isPaidModel = (model: string) => model === "opencode/claude-opus-5-5"

describe("doctor shows the model each agent will really use (fork 0.6)", () => {
  it("resolves non-overridden agents like the runtime: available, connected, free-preferred", () => {
    // when
    const info = getModelResolutionInfoWithOverrides({}, { availableModels: available, connectedProviders: ["opencode"], isPaidModel })
    const sisyphus = info.agents.find((agent) => agent.name === "sisyphus")

    // then
    expect(sisyphus?.effectiveModel).toBe("opencode/big-pickle")
  })

  it("an agent whose chain has nothing available shows the session model", () => {
    // when
    const info = getModelResolutionInfoWithOverrides({}, { availableModels: available, connectedProviders: ["opencode"], isPaidModel })
    const explore = info.agents.find((agent) => agent.name === "explore")

    // then
    expect(explore?.effectiveModel).toBe(SESSION_MODEL)
    expect(explore?.effectiveResolution).toContain("session model")
  })

  it("a user override is shown as is, even when paid", () => {
    // when
    const info = getModelResolutionInfoWithOverrides(
      { agents: { atlas: { model: "opencode/claude-opus-5-5" } } },
      { availableModels: available, connectedProviders: ["opencode"], isPaidModel },
    )

    // then
    expect(info.agents.find((agent) => agent.name === "atlas")?.effectiveModel).toBe("opencode/claude-opus-5-5")
  })

  it("without runtime data the upstream display is unchanged", () => {
    // when
    const info = getModelResolutionInfoWithOverrides({})

    // then
    expect(info.agents.find((agent) => agent.name === "sisyphus")?.effectiveModel).toBe("anthropic/claude-opus-5-5")
  })
})
