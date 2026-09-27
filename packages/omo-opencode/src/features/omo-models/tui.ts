import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

import { buildChainEntries, CONFIGURABLE_AGENTS, readAgentChain } from "../../cli/config-models/agent-chains"
import { getAgentProfile } from "../../cli/config-models/agent-profiles"
import { chainEdits, readOpenCodeSection } from "../../cli/config-models/context"
import type { OpenCodeSection } from "../../cli/config-models/context"
import { loadModelCatalog } from "../../cli/config-models/model-catalog"
import type { ModelInfo } from "../../cli/config-models/model-catalog"
import { createExternalDataStore } from "./external-data"
import type { ExternalData, ExternalDataStore, ReliabilityFacts } from "./external-data"
import { collectFacts, detailRows, previewLine, wrapText } from "./model-facts"
import { buildModelOptions } from "./model-options"
import type { ProviderModelView, ProviderView } from "./model-options"

export const MAX_CHAIN = 4
const DONE = "__omo_models_done__"
const CONFIRM = "__omo_models_confirm__"
const BACK = "__omo_models_back__"
const WRAP_WIDTH = 50
const FOOTER_WRAP_WIDTH = 36
const RELIABILITY_WAIT_MS = 1500

type SelectOption<Value> = {
  readonly title: string
  readonly value: Value
  readonly description?: string
  readonly footer?: string
  readonly category?: string
}

export type OmoModelsTuiApi = {
  readonly command?: {
    readonly register: (factory: () => readonly unknown[]) => (() => void) | undefined
  }
  readonly state: { readonly provider: readonly ProviderView[] }
  readonly ui: {
    readonly dialog: { readonly replace: (render: () => unknown) => void; readonly clear: () => void }
    readonly DialogSelect: <Value>(props: {
      readonly title: string
      readonly placeholder?: string
      readonly options: readonly SelectOption<Value>[]
      readonly current?: Value
      readonly onSelect?: (option: SelectOption<Value>) => void
    }) => unknown
    readonly toast?: (input: { readonly message: string; readonly variant?: "info" | "success" | "warning" | "error" }) => void
  }
}

export type OmoModelsConfigIo = {
  readonly read: () => OpenCodeSection
  readonly save: (agent: string, chain: readonly string[], section: OpenCodeSection) => string
}

export type OmoModelsDeps = {
  readonly io: OmoModelsConfigIo
  readonly catalog: () => ReadonlyMap<string, ModelInfo>
  readonly external: ExternalDataStore
}

export const DEFAULT_CONFIG_IO: OmoModelsConfigIo = {
  read: () => readOpenCodeSection(resolveUserOmoConfigPath()),
  save: (agent, chain, section) => {
    const entries = buildChainEntries(chain, readAgentChain(section.agents[agent]))
    return updateOmoConfig({ edits: chainEdits(agent, entries), scope: "user" }).path
  },
}

function defaultDeps(): OmoModelsDeps {
  return {
    io: DEFAULT_CONFIG_IO,
    catalog: () => loadModelCatalog(),
    external: createExternalDataStore({ artificialAnalysisKey: process.env["ARTIFICIAL_ANALYSIS_API_KEY"] || undefined }),
  }
}

function currentChain(section: OpenCodeSection, agent: string): string[] {
  return readAgentChain(section.agents[agent]).map((entry) => (typeof entry === "string" ? entry : entry.model))
}

export function buildAgentOptions(section: OpenCodeSection, available: ReadonlySet<string>): SelectOption<string>[] {
  return CONFIGURABLE_AGENTS.map((agent) => {
    const chain = currentChain(section, agent)
    const missing = chain.filter((model) => !available.has(model))
    return {
      title: agent,
      value: agent,
      description: chain.length === 0 ? `${getAgentProfile(agent).summary} · omo default` : chain.join(" > "),
      footer: chain.length > 0 && missing.length === chain.length ? "broken" : missing.length > 0 ? "model gone" : "",
    }
  })
}

function findModel(providers: readonly ProviderView[], id: string): { provider: string; model: ProviderModelView } | undefined {
  for (const provider of providers) {
    if (!id.startsWith(`${provider.id}/`)) continue
    const modelId = id.slice(provider.id.length + 1)
    const model = Object.values(provider.models).find((entry) => entry.id === modelId) ?? provider.models[modelId]
    if (model !== undefined) return { provider: provider.id, model }
  }
  return undefined
}

export function openOmoModels(api: OmoModelsTuiApi, deps: OmoModelsDeps = defaultDeps()): void {
  let section: OpenCodeSection
  try {
    section = deps.io.read()
  } catch (error) {
    api.ui.toast?.({ message: `Cannot read ~/.omo/omo.jsonc: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
    return
  }

  const catalog = deps.catalog()
  let external: ExternalData | undefined
  void deps.external.load().then((data) => {
    external = data
  })

  const factsFor = (provider: string, model: ProviderModelView, reliability?: ReliabilityFacts) =>
    collectFacts({ provider, model, catalog, external, reliability })
  const modelOptions = (exclude: readonly string[]) => buildModelOptions(api.state.provider, {
    disabledProviders: section.disabledProviders,
    exclude,
    describe: (provider, model) => previewLine(factsFor(provider, model)),
  })
  const available = new Set(modelOptions([]).map((option) => option.value))
  let screen = 0

  const save = (agent: string, chain: readonly string[]): void => {
    api.ui.dialog.clear()
    try {
      deps.io.save(agent, chain, section)
      api.ui.toast?.({ message: `${agent}: ${chain.join(" > ")}. Restart OpenCode to apply.`, variant: "success" })
    } catch (error) {
      api.ui.toast?.({ message: `Could not save: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
    }
  }

  const accept = (agent: string, chain: readonly string[], modelId: string): void => {
    const next = [...chain, modelId]
    if (next.length >= MAX_CHAIN) save(agent, next)
    else pickModel(agent, next)
  }

  const openDetails = (agent: string, chain: readonly string[], modelId: string): void => {
    const found = findModel(api.state.provider, modelId)
    if (found?.provider !== "openrouter") {
      showDetails(agent, chain, modelId)
      return
    }
    const thisScreen = ++screen
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), RELIABILITY_WAIT_MS))
    void Promise.race([deps.external.reliability(found.model.id), timeout]).then((facts) => {
      if (screen === thisScreen) showDetails(agent, chain, modelId, facts)
    })
  }

  const showDetails = (agent: string, chain: readonly string[], modelId: string, reliability?: ReliabilityFacts): void => {
    const found = findModel(api.state.provider, modelId)
    if (found === undefined) {
      accept(agent, chain, modelId)
      return
    }
    screen++
    const facts = factsFor(found.provider, found.model, reliability)
    const role = chain.length === 0 ? "primary" : `fallback ${chain.length}`
    const info: SelectOption<string>[] = detailRows(agent, facts).flatMap((row, index) =>
      wrapText(row.title, row.footer ? FOOTER_WRAP_WIDTH : WRAP_WIDTH).map((line, part) => ({
        title: line,
        value: `__info_${index}_${part}__`,
        category: row.category,
        ...(row.footer && part === 0 ? { footer: row.footer } : {}),
      })),
    )

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: `${modelId} for ${agent}?`,
        placeholder: "Search details...",
        options: [
          { title: `✓ Yes, use it as ${role}`, value: CONFIRM, category: "Decision" },
          { title: "← No, back to the list", value: BACK, category: "Decision" },
          ...info,
        ],
        current: CONFIRM,
        onSelect: (option) => {
          if (option.value === CONFIRM) accept(agent, chain, modelId)
          else if (option.value === BACK) pickModel(agent, chain)
          else showDetails(agent, chain, modelId, reliability)
        },
      }),
    )

  }

  const pickModel = (agent: string, chain: readonly string[]): void => {
    screen++
    const primary = chain.length === 0
    const done: SelectOption<string>[] = primary
      ? []
      : [{ title: "✓ Done, save", value: DONE, description: chain.join(" > "), category: "Chain" }]
    const current = primary ? currentChain(section, agent).find((model) => available.has(model)) : undefined

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: primary ? `${agent}: primary model` : `${agent}: fallback ${chain.length} (used if the ones above fail)`,
        placeholder: "Search models... (Enter shows details before adding)",
        options: [...done, ...modelOptions(chain)],
        ...(current === undefined ? {} : { current }),
        onSelect: (option) => {
          if (option.value === DONE) save(agent, chain)
          else openDetails(agent, chain, option.value)
        },
      }),
    )
  }

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<string>({
      title: "Choose models for an omo agent",
      placeholder: "Search agents...",
      options: buildAgentOptions(section, available),
      onSelect: (option) => pickModel(option.value, []),
    }),
  )
}

export function registerOmoModelsTui(api: OmoModelsTuiApi, deps?: OmoModelsDeps): () => void {
  return (
    api.command?.register(() => [
      {
        title: "omo: agent models",
        value: "omo.models",
        description: "Pick the primary and fallback models of each oh-my-openagent agent",
        category: "Agent",
        enabled: true,
        slash: { name: "omo-models", aliases: ["agent-models"] },
        onSelect: () => openOmoModels(api, deps ?? defaultDeps()),
      },
    ]) ?? (() => undefined)
  )
}
