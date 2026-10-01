/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as shared from "../../shared"
import { resetAgentRegistrationReport, takeAgentRegistrationIssues } from "../../shared/agent-registration-report"
import { createBuiltinAgents } from "../builtin-agents"

type Spy = { mockRestore: () => void }

const RETIRED = "opencode/deepseek-v4-flash-free"

describe("agents configured with a model OpenCode no longer offers (fork 0.7)", () => {
  let spies: Spy[] = []

  function environment(available: string[]): void {
    spies = [
      spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["opencode"]),
      spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue(null),
      spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set(available)),
    ]
  }

  beforeEach(() => resetAgentRegistrationReport())
  afterEach(() => spies.forEach((spy) => spy.mockRestore()))

  test("a subagent moves to its first offered fallback and the user is told", async () => {
    // given
    environment(["opencode/big-pickle"])

    // when
    const agents = await createBuiltinAgents([], {
      explore: { model: RETIRED, fallback_models: ["opencode/north-mini-code-free", "opencode/big-pickle"] },
    })

    // then
    expect(agents.explore?.model).toBe("opencode/big-pickle")
    const issue = takeAgentRegistrationIssues().find((entry) => entry.agent === "explore")
    expect(issue?.status).toBe("replaced")
    expect(issue?.from).toBe(RETIRED)
    expect(issue?.to).toBe("opencode/big-pickle")
  })

  test("a subagent with only retired models never keeps them", async () => {
    // given
    environment(["opencode/big-pickle"])

    // when
    const agents = await createBuiltinAgents([], { explore: { model: RETIRED, fallback_models: ["opencode/north-mini-code-free"] } })

    // then
    expect(agents.explore).toBeDefined()
    expect(agents.explore?.model).not.toBe(RETIRED)
    expect(takeAgentRegistrationIssues().find((entry) => entry.agent === "explore")?.status).toBe("replaced")
  })

  test("orchestrators without fallback_models are replaced too", async () => {
    // given
    environment(["opencode/big-pickle"])

    // when
    const agents = await createBuiltinAgents([], { atlas: { model: RETIRED }, sisyphus: { model: RETIRED } })

    // then
    expect(agents.atlas?.model).not.toBe(RETIRED)
    expect(agents.sisyphus?.model).not.toBe(RETIRED)
    const replaced = takeAgentRegistrationIssues().filter((entry) => entry.status === "replaced").map((entry) => entry.agent)
    expect(replaced).toEqual(expect.arrayContaining(["atlas", "sisyphus"]))
  })

  test("a model from a provider whose list we do not hold is kept untouched", async () => {
    // given
    environment(["opencode/big-pickle"])

    // when
    const agents = await createBuiltinAgents([], { explore: { model: "ollama/qwen3:8b" } })

    // then
    expect(agents.explore?.model).toBe("ollama/qwen3:8b")
    expect(takeAgentRegistrationIssues().find((entry) => entry.agent === "explore")).toBeUndefined()
  })
})
