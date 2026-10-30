import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"

import { buildChainEntries, CONFIGURABLE_AGENTS, readAgentChain } from "../../cli/config-models/agent-chains"
import { getAgentProfile } from "../../cli/config-models/agent-profiles"
import { chainEdits, pruneChainEdits, readOpenCodeSection } from "../../cli/config-models/context"
import type { OpenCodeSection } from "../../cli/config-models/context"
import { loadModelCatalog } from "../../cli/config-models/model-catalog"
import type { ModelInfo } from "../../cli/config-models/model-catalog"
import { createExternalDataStore } from "./external-data"
import type { ExternalData, ExternalDataStore, ReliabilityFacts } from "./external-data"
import { collectFacts, detailRows, previewLine, wrapText } from "./model-facts"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { listBrokenModels } from "../../shared/broken-models-cache"
import { buildModelOptions, NOT_SERVED_LABEL, RETIRED_LABEL } from "./model-options"
import type { ProviderModelView, ProviderView } from "./model-options"

export const MAX_CHAIN = 4
const DONE = "__omo_models_done__"
const CONFIRM = "__omo_models_confirm__"
const BACK = "__omo_models_back__"
const PRUNE = "__omo_models_prune__"
/** OpenCode's own model dialog; confirming a model there pins it as the TUI's pick for the current agent. */
const MODEL_LIST_COMMAND = "model.list"
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
  readonly state: {
    readonly provider: readonly ProviderView[]
    readonly session?: { readonly messages: (sessionID: string) => readonly unknown[] }
    /** OpenCode's config; `default_agent` is the agent of a new session. */
    readonly config?: { readonly default_agent?: string }
  }
  readonly route?: { readonly current: { readonly name: string; readonly params?: Readonly<Record<string, unknown>> } }
  /** `dispatchCommand` returns @opentui/keymap's RunCommandResult (`{ ok: true }` when the command ran). */
  readonly keymap?: { readonly dispatchCommand?: (command: string) => unknown }
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
  /** Same as `oh-my-openagent config models --prune`: drops dead models from every chain; returns one line per agent. */
  readonly prune: (section: OpenCodeSection, isDead: (model: string) => boolean) => readonly string[]
}

export type OmoModelsDeps = {
  readonly io: OmoModelsConfigIo
  readonly catalog: () => ReadonlyMap<string, ModelInfo>
  readonly external: ExternalDataStore
  /** Models marked "not served" in the last 24 h; defaults to the shared broken-models cache. */
  readonly notServed?: () => ReadonlySet<string>
}

export const DEFAULT_CONFIG_IO: OmoModelsConfigIo = {
  read: () => readOpenCodeSection(resolveUserOmoConfigPath()),
  save: (agent, chain, section) => {
    const entries = buildChainEntries(chain, readAgentChain(section.agents[agent]))
    return updateOmoConfig({ edits: chainEdits(agent, entries), scope: "user" }).path
  },
  prune: (section, isDead) => {
    const { edits, report } = pruneChainEdits(section, isDead)
    if (edits.length > 0) updateOmoConfig({ edits, scope: "user" })
    return report
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

function chainFooter(chain: readonly string[], isRetired: (model: string) => boolean, notServed: ReadonlySet<string>): string {
  const unusable = chain.filter((model) => isRetired(model) || notServed.has(model))
  if (chain.length > 0 && unusable.length === chain.length) return "broken"
  if (chain.some((model) => notServed.has(model))) return NOT_SERVED_LABEL
  return unusable.length > 0 ? RETIRED_LABEL : ""
}

/**
 * A chain model OpenCode will not run: no longer listed by its provider (OpenCode drops deprecated models from the
 * list), or listed but marked deprecated by models.dev.
 */
export function retiredModelCheck(
  available: ReadonlySet<string>,
  catalog: ReadonlyMap<string, ModelInfo>,
  providers: readonly ProviderView[] = [],
): (model: string) => boolean {
  const deprecated = new Set<string>()
  for (const provider of providers) {
    for (const [key, model] of Object.entries(provider.models)) {
      if (model.status === "deprecated") deprecated.add(`${provider.id}/${model.id || key}`)
    }
  }
  return (model) => !available.has(model) || deprecated.has(model) || catalog.get(model)?.status === "deprecated"
}

export function buildAgentOptions(
  section: OpenCodeSection,
  isRetired: (model: string) => boolean,
  notServed: ReadonlySet<string> = new Set(),
): SelectOption<string>[] {
  return CONFIGURABLE_AGENTS.map((agent) => {
    const chain = currentChain(section, agent)
    return {
      title: agent,
      value: agent,
      description: chain.length === 0 ? `${getAgentProfile(agent).summary} · omo default` : chain.join(" > "),
      footer: chainFooter(chain, isRetired, notServed),
    }
  })
}

/** Agents whose chain holds a retired or not-served model, with the dead models. */
function deadModelsByAgent(section: OpenCodeSection, isDead: (model: string) => boolean): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const agent of CONFIGURABLE_AGENTS) {
    const dead = currentChain(section, agent).filter(isDead)
    if (dead.length > 0) result.set(agent, dead)
  }
  return result
}

/**
 * The agent OpenCode's own model dialog would pin: the agent of the last user message in the open session, or on the
 * home screen (no session yet) the default agent. The TUI API does not expose a Tab switch made on the home screen,
 * so the toast always names the agent the model list is for.
 */
export function currentTuiAgent(api: OmoModelsTuiApi): string | undefined {
  const route = api.route?.current
  const sessionID = route?.name === "session" ? route.params?.["sessionID"] : undefined
  if (route?.name !== "session") {
    const fallback = api.state.config?.default_agent
    return typeof fallback === "string" ? getAgentConfigKey(fallback) : undefined
  }
  if (typeof sessionID !== "string" || !api.state.session) return undefined
  const messages = api.state.session.messages(sessionID)
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index] as { readonly role?: unknown; readonly agent?: unknown } | undefined
    if (message?.role === "user" && typeof message.agent === "string") return getAgentConfigKey(message.agent)
  }
  return undefined
}

/** Opens OpenCode's model dialog; false when the command is missing or did not run. */
function openNativeModelList(api: OmoModelsTuiApi): boolean {
  try {
    const result = api.keymap?.dispatchCommand?.(MODEL_LIST_COMMAND)
    return typeof result === "object" && result !== null && (result as { readonly ok?: unknown }).ok === true
  } catch {
    return false
  }
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

/**
 * /omo-models changes apply live (fork plan real-use-incidents A1). When the saved agent is the TUI's current agent,
 * OpenCode's model dialog was just opened: OpenCode keeps its own model pick per agent, and confirming it there pins
 * the new primary. A chain with one model has nothing to fall back to.
 */
export function savedToast(
  agent: string,
  chain: readonly string[],
  confirmInModelList = false,
): { message: string; variant: "success" | "warning" } {
  const fallbacks = chain.length > 1 ? ` (fallbacks: ${chain.slice(1).join(" > ")})` : ""
  const next = confirmInModelList
    ? `Confirm it in the model list that just opened for ${agent} (OpenCode keeps its own pick per agent).`
    : "Applies from your next message."
  const applied = `Saved: ${agent} → ${chain[0] ?? "omo default"}${fallbacks}. ${next}`
  return chain.length === 1
    ? { message: `${applied} No fallback: if ${chain[0]} fails, ${agent} has no other model to switch to.`, variant: "warning" }
    : { message: applied, variant: "success" }
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
  const notServed = (deps.notServed ?? listBrokenModels)()
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
    notServed,
  })
  const available = new Set(modelOptions([]).map((option) => option.value))
  const isRetired = retiredModelCheck(available, catalog, api.state.provider)
  const isDead = (model: string) => isRetired(model) || notServed.has(model)
  let screen = 0

  const save = (agent: string, chain: readonly string[]): void => {
    api.ui.dialog.clear()
    try {
      deps.io.save(agent, chain, section)
    } catch (error) {
      api.ui.toast?.({ message: `Could not save: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
      return
    }
    const confirm = currentTuiAgent(api) === agent && openNativeModelList(api)
    api.ui.toast?.(savedToast(agent, chain, confirm))
  }

  const prune = (): void => {
    api.ui.dialog.clear()
    try {
      const report = deps.io.prune(section, isDead)
      const removed = report.map((line) => line.replace(/\s+/g, " ").trim()).join("; ")
      api.ui.toast?.(report.length === 0
        ? { message: "No retired or not-served models in the agent chains.", variant: "info" }
        : { message: `Removed retired models (backup kept): ${removed}`, variant: "success" })
    } catch (error) {
      api.ui.toast?.({ message: `Could not prune: ${error instanceof Error ? error.message : String(error)}`, variant: "error" })
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
    const current = primary
      ? currentChain(section, agent).find((model) => !isDead(model))
      : undefined

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

  const dead = deadModelsByAgent(section, isDead)
  const pruneOption: SelectOption<string>[] = dead.size === 0
    ? []
    : [{
        title: "Remove retired models from all chains",
        value: PRUNE,
        description: [...dead].map(([agent, models]) => `${agent}: ${models.join(", ")}`).join(" · "),
        footer: "cleanup",
      }]

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<string>({
      title: "Choose models for an omo agent",
      placeholder: "Search agents...",
      options: [...pruneOption, ...buildAgentOptions(section, isRetired, notServed)],
      onSelect: (option) => {
        if (option.value === PRUNE) prune()
        else pickModel(option.value, [])
      },
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
