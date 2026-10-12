/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { OpenCodeSection } from "../../cli/config-models/context"
import type { ModelInfo } from "../../cli/config-models/model-catalog"
import { buildModelOptions, ZEN_CATEGORY, ZEN_FREE_CATEGORY } from "./model-options"
import type { ProviderView } from "./model-options"
import { openOmoModels, registerOmoModelsTui } from "./tui"
import type { OmoModelsConfigIo, OmoModelsDeps, OmoModelsTuiApi } from "./tui"

const PROVIDERS: ProviderView[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    models: {
      "qwen/qwen3:free": { id: "qwen/qwen3:free", cost: { input: 0, output: 0 } },
      "openai/gpt-5.6-sol": { id: "openai/gpt-5.6-sol", cost: { input: 2, output: 10 }, limit: { context: 1_100_000 } },
    },
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    models: {
      "claude-opus-5": { id: "claude-opus-5", name: "Claude Opus 5", cost: { input: 5, output: 25 } },
      "big-pickle": { id: "big-pickle", name: "Big Pickle", cost: { input: 0, output: 0 }, limit: { context: 200_000 } },
      "nemotron-free": { id: "nemotron-free", cost: { input: 0.1, output: 0.1 } },
    },
  },
  { id: "openai", name: "OpenAI", models: { "gpt-5.6-sol": { id: "gpt-5.6-sol", cost: { input: 4, output: 20 } } } },
]

type Dialog = { title: string; options: { title: string; value: string; category?: string; footer?: string }[]; current?: string; onSelect: (option: { value: string }) => void }

type FakeApiOptions = {
  readonly currentAgent?: string
  readonly dispatch?: ((command: string) => unknown) | null
  readonly providers?: ProviderView[]
}

function fakeApi(options: FakeApiOptions = {}) {
  const dialogs: Dialog[] = []
  const toasts: string[] = []
  const dispatched: string[] = []
  let cleared = 0
  const dispatch = options.dispatch === undefined ? () => ({ ok: true }) : options.dispatch
  const api: OmoModelsTuiApi = {
    state: {
      provider: options.providers ?? PROVIDERS,
      session: {
        messages: (sessionID) => (sessionID === "ses_1" && options.currentAgent
          ? [{ role: "user", agent: "build" }, { role: "assistant", agent: "build" }, { role: "user", agent: options.currentAgent }, { role: "assistant" }]
          : []),
      },
    },
    route: { current: { name: "session", params: { sessionID: "ses_1" } } },
    ...(dispatch === null ? {} : { keymap: { dispatchCommand: (command: string) => {
      dispatched.push(command)
      return dispatch(command)
    } } }),
    ui: {
      dialog: { replace: (render) => dialogs.push(render() as Dialog), clear: () => cleared++ },
      DialogSelect: (props) => props,
      toast: (input) => toasts.push(input.message),
    },
  }
  const choose = (value: string) => {
    const dialog = dialogs.at(-1)
    const option = dialog?.options.find((entry) => entry.value === value)
    if (!dialog || !option) throw new Error(`option ${value} not in "${dialog?.title}"`)
    dialog.onSelect(option)
  }
  return { api, dialogs, toasts, dispatched, choose, cleared: () => cleared }
}

const SECTION: OpenCodeSection = {
  agents: { explore: { model: "opencode/retired-free", fallback_models: ["opencode/big-pickle"] } },
  runtimeFallback: undefined,
  disabledProviders: ["openai"],
}

type Pruned = { removed: string[] }

function io(saved: { agent: string; chain: readonly string[] }[], section: OpenCodeSection = SECTION, pruned?: Pruned): OmoModelsConfigIo {
  return {
    read: () => section,
    save: (agent, chain) => {
      saved.push({ agent, chain })
      return "/tmp/omo.jsonc"
    },
    prune: (current, isDead) => {
      const lines: string[] = []
      for (const [agent, config] of Object.entries(current.agents)) {
        const { model, fallback_models: fallbacks = [], models = [] } = config as { model?: string; fallback_models?: string[]; models?: string[] }
        const dead = [...(model ? [model] : []), ...fallbacks, ...models].filter(isDead)
        if (dead.length > 0) lines.push(`${agent.padEnd(19)}removed ${dead.join(", ")}`)
        pruned?.removed.push(...dead)
      }
      return lines
    },
  }
}

function deps(
  saved: { agent: string; chain: readonly string[] }[],
  notServed: readonly string[] = [],
  extra: { section?: OpenCodeSection; pruned?: Pruned; catalog?: ReadonlyMap<string, ModelInfo> } = {},
): OmoModelsDeps {
  return {
    io: io(saved, extra.section, extra.pruned),
    notServed: () => new Set(notServed),
    catalog: () => extra.catalog ?? new Map(),
    external: { load: async () => ({ fetchedAt: "", benchmarks: {}, openRouter: {} }), reliability: async () => undefined },
  }
}

describe("buildModelOptions", () => {
  test("lists OpenCode Zen free first, then the rest of Zen, then other providers; honors disabled providers", () => {
    // when
    const options = buildModelOptions(PROVIDERS, { disabledProviders: ["openai"] })

    // then
    expect(options.map((option) => [option.category, option.value, option.footer])).toEqual([
      [ZEN_FREE_CATEGORY, "opencode/big-pickle", "Free"],
      [ZEN_FREE_CATEGORY, "opencode/nemotron-free", "Free"],
      [ZEN_CATEGORY, "opencode/claude-opus-5", "$5/$25"],
      ["OpenRouter", "openrouter/openai/gpt-5.6-sol", "$2/$10"],
      ["OpenRouter", "openrouter/qwen/qwen3:free", "Free"],
    ])
    expect(options[0]?.description).toBe("200k ctx")
  })
})

describe("/omo-models", () => {
  test("registers a slash command", () => {
    // given
    const registered: unknown[] = []
    const api = { ...fakeApi().api, command: { register: (factory: () => readonly unknown[]) => {
      registered.push(...factory())
      return () => undefined
    } } }

    // when
    registerOmoModelsTui(api, deps([]))

    // then
    expect(registered).toMatchObject([{ slash: { name: "omo-models" } }])
  })

  test("agent -> primary -> fallback -> done saves the ordered chain", async () => {
    // given
    const saved: { agent: string; chain: readonly string[] }[] = []
    const { api, dialogs, toasts, choose } = fakeApi()

    // when
    openOmoModels(api, deps(saved))
    const agents = dialogs[0]
    choose("explore")
    const primaryDialog = dialogs.at(-1)
    choose("opencode/nemotron-free")
    const details = dialogs.at(-1)
    choose("__omo_models_confirm__")
    choose("openrouter/qwen/qwen3:free")
    await Bun.sleep(0)
    choose("__omo_models_confirm__")
    choose("__omo_models_done__")

    // then
    expect(agents?.options.map((option) => option.value)).not.toContain("build")
    expect(agents?.options.find((option) => option.value === "explore")?.footer).toBe("retired")
    expect(primaryDialog?.current).toBe("opencode/big-pickle")
    expect(primaryDialog?.options.some((option) => option.value.startsWith("openai/"))).toBe(false)
    expect(saved).toEqual([{ agent: "explore", chain: ["opencode/nemotron-free", "openrouter/qwen/qwen3:free"] }])
    expect(toasts.at(-1)).toContain("Applies from your next message")
    expect(toasts.at(-1)).not.toContain("Restart")
    expect(details?.title).toBe("opencode/nemotron-free for explore?")
    expect(details?.options.some((option) => option.category === "Fit for explore")).toBe(true)
    expect(details?.options.some((option) => option.title.startsWith("Free on OpenCode Zen only") && option.category === "Free tier")).toBe(true)
  })

  test("fallback dialogs hide models already in the chain and stop at the maximum length", async () => {
    // given
    const saved: { agent: string; chain: readonly string[] }[] = []
    const { api, dialogs, choose } = fakeApi()

    // when
    openOmoModels(api, deps(saved))
    choose("oracle")
    choose("opencode/big-pickle")
    choose("__omo_models_confirm__")
    const fallbackDialog = dialogs.at(-1)
    for (const model of ["opencode/nemotron-free", "opencode/claude-opus-5", "openrouter/qwen/qwen3:free"]) {
      choose(model)
      await Bun.sleep(0)
      choose("__omo_models_confirm__")
    }

    // then
    expect(fallbackDialog?.options[0]?.value).toBe("__omo_models_done__")
    expect(fallbackDialog?.options.map((option) => option.value)).not.toContain("opencode/big-pickle")
    expect(saved).toEqual([{ agent: "oracle", chain: ["opencode/big-pickle", "opencode/nemotron-free", "opencode/claude-opus-5", "openrouter/qwen/qwen3:free"] }])
  })
})

describe("/omo-models live apply and not-served models (real-use incidents A1, A2)", () => {
  test("saving a chain with a single model warns that it has no fallback", () => {
    // given
    const saved: { agent: string; chain: readonly string[] }[] = []
    const { api, toasts, choose } = fakeApi()

    // when
    openOmoModels(api, deps(saved))
    choose("oracle")
    choose("opencode/big-pickle")
    choose("__omo_models_confirm__")
    choose("__omo_models_done__")

    // then
    expect(saved).toEqual([{ agent: "oracle", chain: ["opencode/big-pickle"] }])
    expect(toasts.at(-1)).toContain("Applies from your next message")
    expect(toasts.at(-1)).toContain("No fallback")
  })

  test("a model listed but not served is labelled 'not served' in the model list and the agent list", () => {
    // given
    const { api, dialogs, choose } = fakeApi()

    // when
    openOmoModels(api, deps([], ["opencode/big-pickle"]))
    const agents = dialogs[0]
    choose("explore")
    const primaryDialog = dialogs.at(-1)

    // then
    expect(agents?.options.find((option) => option.value === "explore")?.footer).toBe("broken")
    expect(primaryDialog?.options.find((option) => option.value === "opencode/big-pickle")?.footer).toBe("not served")
    expect(primaryDialog?.current).toBeUndefined()
  })
})

describe("model details screen", () => {
  test("going back returns to the list without adding the model", () => {
    // given
    const saved: { agent: string; chain: readonly string[] }[] = []
    const { api, dialogs, choose } = fakeApi()

    // when
    openOmoModels(api, deps(saved))
    choose("explore")
    choose("opencode/claude-opus-5")
    choose("__omo_models_back__")

    // then
    expect(dialogs.at(-1)?.title).toBe("explore: primary model")
    expect(saved).toEqual([])
  })
})

function catalogEntry(id: string, status?: string): ModelInfo {
  return {
    id, name: id, description: undefined, family: undefined, contextTokens: undefined, outputTokens: undefined,
    inputModalities: ["text"], reasoning: false, toolCall: true, costInput: 0, costOutput: 0, releaseDate: undefined,
    knowledge: undefined, openWeights: false, ...(status ? { status } : {}),
  }
}

function saveOracleChain(choose: (value: string) => void): void {
  choose("oracle")
  choose("opencode/big-pickle")
  choose("__omo_models_confirm__")
  choose("opencode/nemotron-free")
  choose("__omo_models_confirm__")
  choose("__omo_models_done__")
}

describe("/omo-models hands the new primary to OpenCode's own model pick (incident: change ignored by the TUI)", () => {
  test("saving the current agent's chain opens OpenCode's model list and says to confirm there", () => {
    // given: the open session's last user message is Oracle's
    const { api, toasts, dispatched, choose } = fakeApi({ currentAgent: "oracle" })

    // when
    openOmoModels(api, deps([]))
    saveOracleChain(choose)

    // then
    expect(dispatched).toEqual(["model.list"])
    expect(toasts.at(-1)).toBe("Saved: oracle → opencode/big-pickle (fallbacks: opencode/nemotron-free). Confirm it in the model list that just opened (OpenCode keeps its own pick per agent).")
  })

  test("saving another agent's chain does not open the model list", () => {
    const { api, toasts, dispatched, choose } = fakeApi({ currentAgent: "Sisyphus - ultraworker" })
    openOmoModels(api, deps([]))
    saveOracleChain(choose)
    expect(dispatched).toEqual([])
    expect(toasts.at(-1)).toBe("Saved: oracle → opencode/big-pickle (fallbacks: opencode/nemotron-free). Applies from your next message.")
  })

  test("without a usable model.list command the toast alone is shown", () => {
    for (const dispatch of [null, () => ({ ok: false, reason: "not-found" }), () => { throw new Error("no keymap") }]) {
      const { api, toasts, choose } = fakeApi({ currentAgent: "oracle", dispatch })
      openOmoModels(api, deps([]))
      saveOracleChain(choose)
      expect(toasts.at(-1)).toContain("Applies from your next message.")
      expect(toasts.at(-1)).not.toContain("Confirm it")
    }
  })
})

describe("/omo-models retired models", () => {
  const RETIRED_SECTION: OpenCodeSection = {
    agents: {
      oracle: { models: ["opencode/claude-opus-5", "opencode/big-pickle"] },
      explore: { models: ["opencode/big-pickle"] },
    },
    runtimeFallback: undefined,
    disabledProviders: [],
  }

  test("a model models.dev marks deprecated is labelled retired and skipped as the current primary", () => {
    // given
    const catalog = new Map([["opencode/claude-opus-5", catalogEntry("opencode/claude-opus-5", "deprecated")]])
    const { api, dialogs, choose } = fakeApi()

    // when
    openOmoModels(api, deps([], [], { section: RETIRED_SECTION, catalog }))
    const agents = dialogs[0]
    choose("oracle")

    // then
    expect(agents?.options.find((option) => option.value === "oracle")?.footer).toBe("retired")
    expect(agents?.options.find((option) => option.value === "explore")?.footer).toBe("")
    expect(dialogs.at(-1)?.current).toBe("opencode/big-pickle")
  })

  test("a listed model with status deprecated is labelled retired in the model list", () => {
    const providers: ProviderView[] = [{ id: "opencode", name: "OpenCode Zen", models: {
      "big-pickle": { id: "big-pickle", cost: { input: 0, output: 0 } },
      "claude-opus-5": { id: "claude-opus-5", cost: { input: 5, output: 25 }, status: "deprecated" },
    } }]
    const { api, dialogs, choose } = fakeApi({ providers })
    openOmoModels(api, deps([], [], { section: RETIRED_SECTION }))
    expect(dialogs[0]?.options.find((option) => option.value === "oracle")?.footer).toBe("retired")
    choose("explore")
    expect(dialogs.at(-1)?.options.find((option) => option.value === "opencode/claude-opus-5")?.footer).toBe("retired")
  })

  test("'Remove retired models from all chains' prunes retired and not-served models", () => {
    // given: explore has a gone model, oracle a not-served one
    const pruned: Pruned = { removed: [] }
    const { api, dialogs, toasts, choose } = fakeApi()
    const section: OpenCodeSection = { ...SECTION, agents: { ...SECTION.agents, oracle: { models: ["opencode/nemotron-free", "opencode/big-pickle"] } } }

    // when
    openOmoModels(api, deps([], ["opencode/nemotron-free"], { section, pruned }))
    const row = dialogs[0]?.options[0]
    choose("__omo_models_prune__")

    // then
    expect(row?.title).toBe("Remove retired models from all chains")
    expect(row?.description).toContain("explore: opencode/retired-free")
    expect(row?.description).toContain("oracle: opencode/nemotron-free")
    expect(pruned.removed.sort()).toEqual(["opencode/nemotron-free", "opencode/retired-free"])
    expect(toasts.at(-1)).toBe("Removed retired models (backup kept): explore removed opencode/retired-free; oracle removed opencode/nemotron-free")
  })

  test("no cleanup row when every chain is usable", () => {
    const { api, dialogs } = fakeApi()
    openOmoModels(api, deps([], [], { section: { ...SECTION, agents: { explore: { models: ["opencode/big-pickle"] } } } }))
    expect(dialogs[0]?.options.map((option) => option.value)).not.toContain("__omo_models_prune__")
  })
})
