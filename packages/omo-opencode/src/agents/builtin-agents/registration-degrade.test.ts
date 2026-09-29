/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as shared from "../../shared"
import { resetAgentRegistrationReport, takeAgentRegistrationIssues } from "../../shared/agent-registration-report"
import { createBuiltinAgents } from "../builtin-agents"

type Spy = { mockRestore: () => void }

describe("agents are degraded, never silently dropped, when no model resolves (fork 0.3)", () => {
  let spies: Spy[] = []

  function environment(connected: string[] | null, available: string[]): void {
    spies = [
      spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(connected),
      spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null),
      spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(available)),
    ]
  }

  beforeEach(() => resetAgentRegistrationReport())
  afterEach(() => spies.forEach((spy) => spy.mockRestore()))

  test("first run without a configured model: Atlas exists and no agent gets a provider the user never connected", async () => {
    // given — the user's real setup: no `model` in opencode.json, no provider cache yet
    environment(null, [])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.atlas).toBeDefined()
    expect(agents.atlas?.model).toBeUndefined()
    expect(agents.sisyphus).toBeDefined()
    expect(agents.sisyphus?.model).toBeUndefined()
    expect(agents.explore?.model).toBeUndefined()
    expect(agents.verifier?.model).toBeUndefined()
    const issues = takeAgentRegistrationIssues()
    expect(issues.find((issue) => issue.agent === "atlas")?.status).toBe("degraded")
    expect(issues.find((issue) => issue.agent === "sisyphus")?.status).toBe("degraded")
  })

  test("warm cache with only the free opencode provider: Atlas gets a free model instead of disappearing", async () => {
    // given
    environment(["opencode"], ["opencode/big-pickle"])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.atlas?.model).toBe("opencode/big-pickle")
  })

  test("warm cache with only ollama: agents stay registered on the session model and the user is told", async () => {
    // given
    environment(["ollama"], ["ollama/qwen3:8b"])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.atlas).toBeDefined()
    expect(agents.atlas?.model).toBeUndefined()
    expect(agents.sisyphus).toBeDefined()
    expect(takeAgentRegistrationIssues().map((issue) => issue.agent)).toContain("atlas")
  })

  test("Hephaestus (GPT only) is skipped visibly, with a reason, when no connected provider serves GPT", async () => {
    // given
    environment(["ollama"], ["ollama/qwen3:8b"])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.hephaestus).toBeUndefined()
    const issue = takeAgentRegistrationIssues().find((entry) => entry.agent === "hephaestus")
    expect(issue?.status).toBe("skipped")
    expect(issue?.detail).toContain("agents.hephaestus.model")
  })

  test("Hephaestus keeps the upstream GPT guess on first run, flagged as unverified", async () => {
    // given
    environment(null, [])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, undefined)

    // then
    expect(agents.hephaestus?.model).toBe("openai/gpt-6-sol")
    const issue = takeAgentRegistrationIssues().find((entry) => entry.agent === "hephaestus")
    expect(issue?.detail).toContain("not verified")
  })

  test("a configured system default model still wins over degrading", async () => {
    // given
    environment(null, [])

    // when
    const agents = await createBuiltinAgents([], {}, undefined, "opencode/big-pickle")

    // then
    expect(agents.atlas?.model).toBe("opencode/big-pickle")
    expect(takeAgentRegistrationIssues().find((issue) => issue.agent === "atlas")).toBeUndefined()
  })
})
