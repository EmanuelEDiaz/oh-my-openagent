/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { OpenCodeSection } from "../../cli/config-models/context"
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

function fakeApi() {
  const dialogs: Dialog[] = []
  const toasts: string[] = []
  let cleared = 0
  const api: OmoModelsTuiApi = {
    state: { provider: PROVIDERS },
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
  return { api, dialogs, toasts, choose, cleared: () => cleared }
}

const SECTION: OpenCodeSection = {
  agents: { explore: { model: "opencode/retired-free", fallback_models: ["opencode/big-pickle"] } },
  runtimeFallback: undefined,
  disabledProviders: ["openai"],
}

function io(saved: { agent: string; chain: readonly string[] }[]): OmoModelsConfigIo {
  return { read: () => SECTION, save: (agent, chain) => {
    saved.push({ agent, chain })
    return "/tmp/omo.jsonc"
  } }
}

function deps(saved: { agent: string; chain: readonly string[] }[], notServed: readonly string[] = []): OmoModelsDeps {
  return {
    io: io(saved),
    notServed: () => new Set(notServed),
    catalog: () => new Map(),
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
    expect(agents?.options.find((option) => option.value === "explore")?.footer).toBe("model gone")
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
