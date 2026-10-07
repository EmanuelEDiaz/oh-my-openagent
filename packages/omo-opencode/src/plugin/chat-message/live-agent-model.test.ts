/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { OpenCodeSection } from "../../cli/config-models/context"
import { createLiveAgentModel } from "./live-agent-model"
import type { LiveAgentModelDeps } from "./live-agent-model"
import type { ChatMessageHandlerOutput } from "./types"

// Real-use incident 07-10-2026 (fork plan real-use-incidents A1): /omo-models saved a chain, nothing changed until restart.
const USER = "/home/u/.omo/omo.jsonc"
const STARTUP: OpenCodeSection = {
  agents: { sisyphus: { models: ["opencode/ling-3.0-flash-fin-free", "opencode/big-pickle"] } },
  runtimeFallback: undefined,
  disabledProviders: [],
}
const SAVED: OpenCodeSection = {
  agents: { sisyphus: { models: [{ model: "opencode/mimo-v2.6-flash-free", variant: "high" }, "opencode/big-pickle"] } },
  runtimeFallback: undefined,
  disabledProviders: [],
}

function harness(options: { broken?: string[]; project?: OpenCodeSection } = {}) {
  let mtime = 1
  let section = STARTUP
  const deps: LiveAgentModelDeps = {
    userConfigPath: USER,
    ...(options.project ? { projectConfigPath: "/p/.omo/omo.jsonc" } : {}),
    modifiedAt: (path) => (path === USER ? mtime : 1),
    read: (path) => (path === USER ? section : (options.project ?? STARTUP)),
    loadedModel: (agent) => (agent === "sisyphus" ? "opencode/ling-3.0-flash-fin-free" : undefined),
    isBroken: (model) => (options.broken ?? []).includes(model),
  }
  const live = createLiveAgentModel(deps)
  const save = (next: OpenCodeSection) => {
    section = next
    mtime++
  }
  const send = (modelID: string, agent = "Sisyphus - ultraworker") => {
    const output: ChatMessageHandlerOutput = { message: {}, parts: [] }
    const applied = live.apply({ sessionID: "ses", agent, model: { providerID: "opencode", modelID } }, output)
    return { applied, output }
  }
  return { save, send }
}

describe("live /omo-models changes (no restart)", () => {
  test("nothing changes while omo.jsonc is untouched", () => {
    const { send } = harness()
    const { applied, output } = send("ling-3.0-flash-fin-free")
    expect(applied).toBeUndefined()
    expect(output.message["model"]).toBeUndefined()
  })

  test("after saving, the next message of that agent uses the new primary and its variant", () => {
    // given
    const { save, send } = harness()
    save(SAVED)

    // when
    const { applied, output } = send("ling-3.0-flash-fin-free")

    // then
    expect(applied).toBe("opencode/mimo-v2.6-flash-free")
    expect(output.message["model"]).toEqual({ providerID: "opencode", modelID: "mimo-v2.6-flash-free" })
    expect(output.message["variant"]).toBe("high")
  })

  test("a model the user picked by hand with /models is never overridden", () => {
    const { save, send } = harness()
    save(SAVED)
    const { applied, output } = send("big-pickle")
    expect(applied).toBeUndefined()
    expect(output.message["model"]).toBeUndefined()
  })

  test("a new primary that is not served is skipped for the next model of the chain", () => {
    const { save, send } = harness({ broken: ["opencode/mimo-v2.6-flash-free"] })
    save(SAVED)
    expect(send("ling-3.0-flash-fin-free").applied).toBe("opencode/big-pickle")
  })

  test("a chain set in the project config wins over the user file", () => {
    const { save, send } = harness({ project: STARTUP })
    save(SAVED)
    expect(send("ling-3.0-flash-fin-free").applied).toBeUndefined()
  })

  test("other agents whose chain did not change are left alone", () => {
    const { save, send } = harness()
    save(SAVED)
    expect(send("ling-3.0-flash-fin-free", "oracle").applied).toBeUndefined()
  })
})
