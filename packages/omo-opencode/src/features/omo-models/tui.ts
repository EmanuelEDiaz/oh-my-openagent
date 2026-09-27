import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

import { buildChainEntries, CONFIGURABLE_AGENTS, readAgentChain } from "../../cli/config-models/agent-chains"
import { getAgentProfile } from "../../cli/config-models/agent-profiles"
import { chainEdits, readOpenCodeSection } from "../../cli/config-models/context"
import type { OpenCodeSection } from "../../cli/config-models/context"
import { buildModelOptions } from "./model-options"
import type { ProviderView } from "./model-options"

export const MAX_CHAIN = 4
const DONE = "__omo_models_done__"

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

export const DEFAULT_CONFIG_IO: OmoModelsConfigIo = {
  read: () => readOpenCodeSection(resolveUserOmoConfigPath()),
  save: (agent, chain, section) => {
    const entries = buildChainEntries(chain, readAgentChain(section.agents[agent]))
    return updateOmoConfig({ edits: chainEdits(agent, entries), scope: "user" }).path
  },
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

export function openOmoModels(api: OmoModelsTuiApi, io: OmoModelsConfigIo = DEFAULT_CONFIG_IO): void {
  let section: OpenCodeSection
  try {
    section = io.read()
  } catch (error) {
    api.ui.toast?.({ message: `Cannot read ~/.omo/omo.jsonc: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
    return
  }

  const allModels = buildModelOptions(api.state.provider, { disabledProviders: section.disabledProviders })
  const available = new Set(allModels.map((option) => option.value))

  const pickModel = (agent: string, chain: string[]): void => {
    const primary = chain.length === 0
    const models: SelectOption<string>[] = allModels.filter((option) => !chain.includes(option.value))
    const done: SelectOption<string>[] = primary
      ? []
      : [{ title: "✓ Done, save", value: DONE, description: chain.join(" > "), category: "Chain" }]
    const current = primary ? currentChain(section, agent).find((model) => available.has(model)) : undefined

    api.ui.dialog.replace(() =>
      api.ui.DialogSelect<string>({
        title: primary ? `${agent}: primary model` : `${agent}: fallback ${chain.length} (used if the ones above fail)`,
        placeholder: "Search models...",
        options: [...done, ...models],
        ...(current === undefined ? {} : { current }),
        onSelect: (option) => {
          if (option.value === DONE) {
            save(agent, chain)
            return
          }
          const next = [...chain, option.value]
          if (next.length >= MAX_CHAIN) save(agent, next)
          else pickModel(agent, next)
        },
      }),
    )
  }

  const save = (agent: string, chain: readonly string[]): void => {
    api.ui.dialog.clear()
    try {
      io.save(agent, chain, section)
      api.ui.toast?.({ message: `${agent}: ${chain.join(" > ")}. Restart OpenCode to apply.`, variant: "success" })
    } catch (error) {
      api.ui.toast?.({ message: `Could not save: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
    }
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

export function registerOmoModelsTui(api: OmoModelsTuiApi, io: OmoModelsConfigIo = DEFAULT_CONFIG_IO): () => void {
  return (
    api.command?.register(() => [
      {
        title: "omo: agent models",
        value: "omo.models",
        description: "Pick the primary and fallback models of each oh-my-openagent agent",
        category: "Agent",
        enabled: true,
        slash: { name: "omo-models", aliases: ["agent-models"] },
        onSelect: () => openOmoModels(api, io),
      },
    ]) ?? (() => undefined)
  )
}
