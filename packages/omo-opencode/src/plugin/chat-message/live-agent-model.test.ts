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

const THIRD: OpenCodeSection = {
  agents: { sisyphus: { models: ["opencode/nemotron-free", "opencode/big-pickle"] } },
  runtimeFallback: undefined,
  disabledProviders: [],
}

type HarnessOptions = {
  broken?: string[]
  retired?: string[]
  fallbackSwitched?: string[]
  project?: OpenCodeSection
  /** omo.jsonc at startup (default STARTUP); loadedModel follows its sisyphus primary. */
  startup?: OpenCodeSection
  /** Persisted primaries from earlier OpenCode runs, shared between harnesses like the cache file. */
  pastPrimaries?: Map<string, string[]>
}

function harness(options: HarnessOptions = {}) {
  let mtime = 1
  let section = options.startup ?? STARTUP
  const past = options.pastPrimaries ?? new Map<string, string[]>()
  const startupPrimary = (section.agents["sisyphus"] as { models: (string | { model: string })[] }).models[0]
  const loaded = typeof startupPrimary === "string" ? startupPrimary : startupPrimary?.model
  const deps: LiveAgentModelDeps = {
    userConfigPath: USER,
    ...(options.project ? { projectConfigPath: "/p/.omo/omo.jsonc" } : {}),
    modifiedAt: (path) => (path === USER ? mtime : 1),
    read: (path) => (path === USER ? section : (options.project ?? STARTUP)),
    loadedModel: (agent) => (agent === "sisyphus" ? loaded : undefined),
    isBroken: (model) => (options.broken ?? []).includes(model),
    isRetired: (model) => (options.retired ?? []).includes(model),
    wasFallbackSwitch: (model) => (options.fallbackSwitched ?? []).includes(model),
    pastPrimaries: (agent) => past.get(agent) ?? [],
    recordPrimary: (agent, model) => {
      const seen = past.get(agent) ?? []
      if (!seen.includes(model)) past.set(agent, [...seen, model])
    },
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
    // OpenCode reads the variant from UserMessage.model.variant; a top-level field is outside its schema.
    expect(output.message["model"]).toEqual({ providerID: "opencode", modelID: "mimo-v2.6-flash-free", variant: "high" })
    expect(output.message["variant"]).toBeUndefined()
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

  test("a deprecated startup model makes the TUI send its recent model: that stand-in is replaced too", () => {
    // given: the TUI rejected the retired startup model and sent recent[0] (big-pickle) instead
    const { save, send } = harness({ retired: ["opencode/ling-3.0-flash-fin-free"] })
    save(SAVED)

    // when
    const { applied, output } = send("big-pickle")

    // then
    expect(applied).toBe("opencode/mimo-v2.6-flash-free")
    expect(output.message["model"]).toEqual({ providerID: "opencode", modelID: "mimo-v2.6-flash-free", variant: "high" })
  })

  test("with a deprecated startup model, a /models pick made after the stand-in is still kept", () => {
    const { save, send } = harness({ retired: ["opencode/ling-3.0-flash-fin-free"] })
    send("big-pickle")
    save(SAVED)
    expect(send("claude-opus-5").applied).toBeUndefined()
  })

  test("a message still on the previous omo.jsonc primary moves to the newest primary", () => {
    // given: the user saved mimo, then confirmed it in the TUI (pinned), then saved a new chain
    const { save, send } = harness()
    save(SAVED)
    send("mimo-v2.6-flash-free")
    save(THIRD)

    // when
    const { applied } = send("mimo-v2.6-flash-free")

    // then
    expect(applied).toBe("opencode/nemotron-free")
  })

  test("a model the plugin's fallback switched to is not a user pick", () => {
    const { save, send } = harness({ fallbackSwitched: ["opencode/claude-opus-5"] })
    save(SAVED)
    expect(send("claude-opus-5").applied).toBe("opencode/mimo-v2.6-flash-free")
  })

  test("a retired model at the head of the new chain is skipped", () => {
    const { save, send } = harness({ retired: ["opencode/mimo-v2.6-flash-free"] })
    save(SAVED)
    expect(send("ling-3.0-flash-fin-free").applied).toBe("opencode/big-pickle")
  })
})

describe("resumed sessions after a restart (incident: /omo-models ignored on a resumed session)", () => {
  test("a resumed session still on a primary from an earlier run moves to the current primary", () => {
    // given: run 1 had ling as primary; the user saved mimo with /omo-models and restarted OpenCode
    const past = new Map<string, string[]>()
    harness({ pastPrimaries: past }).send("ling-3.0-flash-fin-free")
    const { send } = harness({ startup: SAVED, pastPrimaries: past })

    // when: the TUI resumes the old session and sends that session's last model
    const { applied, output } = send("ling-3.0-flash-fin-free")

    // then
    expect(applied).toBe("opencode/mimo-v2.6-flash-free")
    expect(output.message["model"]).toEqual({ providerID: "opencode", modelID: "mimo-v2.6-flash-free", variant: "high" })
  })

  test("a primary saved live in an earlier run is remembered across the restart too", () => {
    const past = new Map<string, string[]>()
    const first = harness({ pastPrimaries: past })
    first.save(SAVED)
    first.send("ling-3.0-flash-fin-free")
    const { send } = harness({ startup: THIRD, pastPrimaries: past })
    expect(send("mimo-v2.6-flash-free").applied).toBe("opencode/nemotron-free")
  })

  test("a resumed session on a model that was never this agent's primary is a user pick and is kept", () => {
    const past = new Map<string, string[]>()
    harness({ pastPrimaries: past }).send("ling-3.0-flash-fin-free")
    const { send } = harness({ startup: SAVED, pastPrimaries: past })
    expect(send("claude-opus-5").applied).toBeUndefined()
  })

  test("another agent's past primary does not count for this agent", () => {
    const past = new Map<string, string[]>([["oracle", ["opencode/ling-3.0-flash-fin-free"]]])
    const { send } = harness({ startup: SAVED, pastPrimaries: past })
    expect(send("ling-3.0-flash-fin-free").applied).toBeUndefined()
  })

  test("a message already on the current primary is left alone", () => {
    const past = new Map<string, string[]>()
    harness({ pastPrimaries: past }).send("ling-3.0-flash-fin-free")
    const { send } = harness({ startup: SAVED, pastPrimaries: past })
    const { applied, output } = send("mimo-v2.6-flash-free")
    expect(applied).toBeUndefined()
    expect(output.message["model"]).toBeUndefined()
  })
})

describe("a retired configured model without any /omo-models change (real TUI, 12-10-2026)", () => {
  const RETIRED_CHAIN: OpenCodeSection = {
    agents: { sisyphus: { models: ["opencode/glm-5-free", "opencode/nemotron-3.5-lightning-free"] } },
    runtimeFallback: undefined,
    disabledProviders: [],
  }

  test("the TUI's stand-in moves to the next usable model of the agent's own chain", () => {
    // given: OpenCode dropped the retired model from its list and the TUI sent its default (big-pickle) instead
    const { send } = harness({ startup: RETIRED_CHAIN, retired: ["opencode/glm-5-free"] })

    // when
    const { applied } = send("big-pickle")

    // then
    expect(applied).toBe("opencode/nemotron-3.5-lightning-free")
  })

  test("every later message of that agent moves too, not only the first", () => {
    const { send } = harness({ startup: RETIRED_CHAIN, retired: ["opencode/glm-5-free"] })
    send("big-pickle")
    expect(send("big-pickle").applied).toBe("opencode/nemotron-3.5-lightning-free")
  })

  test("a /models pick made after that is still respected", () => {
    const { send } = harness({ startup: RETIRED_CHAIN, retired: ["opencode/glm-5-free"] })
    send("big-pickle")
    expect(send("claude-opus-5").applied).toBeUndefined()
  })

  test("with a usable configured model nothing changes", () => {
    const { send } = harness()
    expect(send("ling-3.0-flash-fin-free").applied).toBeUndefined()
  })
})
