import type { OmoConfigEdit } from "@oh-my-opencode/omo-config-core"

import { buildChainEntries, readAgentChain } from "./agent-chains"
import type { ChainAvailability } from "./agent-chains"
import {
  chainEdits,
  currentModels,
  formatChainSummary,
  isRuntimeFallbackEnabled,
  printStatuses,
  rankForAgent,
  runtimeFallbackEdit,
  statusesFor,
  unconnectedOllamaModels,
  writeEdits,
} from "./context"
import type { ModelsContext } from "./context"
import { suggestChain } from "./model-ranking"
import { connectOllamaModels } from "./opencode-config"
import { buildPreset } from "./presets"
import { ollamaModelId } from "./ollama"
import type * as defaultPrompts from "./prompts"

export type ConfigModelsPrompts = {
  readonly promptMainMenu: typeof defaultPrompts.promptMainMenu
  readonly promptAgent: typeof defaultPrompts.promptAgent
  readonly promptMode: typeof defaultPrompts.promptMode
  readonly promptChain: typeof defaultPrompts.promptChain
  readonly promptSource: typeof defaultPrompts.promptSource
  readonly promptPreset: typeof defaultPrompts.promptPreset
  readonly promptConnectOllama: typeof defaultPrompts.promptConnectOllama
  readonly showSuggestedFixes: typeof defaultPrompts.showSuggestedFixes
  readonly promptAcceptFixes: typeof defaultPrompts.promptAcceptFixes
  readonly promptEnableRuntimeFallback: typeof defaultPrompts.promptEnableRuntimeFallback
  readonly promptConfirmWrite: typeof defaultPrompts.promptConfirmWrite
}

type Pending = Map<string, readonly string[]>

async function configureAgent(context: ModelsContext, prompts: ConfigModelsPrompts, agent: string, pending: Pending): Promise<boolean> {
  const mode = await prompts.promptMode(agent)
  if (mode === null) return false
  const ranked = rankForAgent(context, agent)
  const current = pending.get(agent) ?? currentModels(context, agent)
  const chain = await prompts.promptChain({ agent, mode, ranked, current })
  if (chain === null) return false
  if (chain.length > 0) pending.set(agent, chain)
  return true
}

async function acceptSuggestions(prompts: ConfigModelsPrompts, suggestions: ReadonlyMap<string, readonly string[]>, pending: Pending): Promise<boolean> {
  if (suggestions.size === 0) return true
  prompts.showSuggestedFixes(formatChainSummary(suggestions))
  const accepted = await prompts.promptAcceptFixes()
  if (accepted === null) return false
  if (accepted) for (const [agent, chain] of suggestions) pending.set(agent, chain)
  return true
}

function brokenSuggestions(context: ModelsContext, statuses: readonly ChainAvailability[], pending: Pending): Map<string, string[]> {
  const suggestions = new Map<string, string[]>()
  for (const status of statuses) {
    if (status.missing.length === 0 || pending.has(status.agent)) continue
    const chain = suggestChain(rankForAgent(context, status.agent))
    if (chain.length > 0) suggestions.set(status.agent, chain)
  }
  return suggestions
}

async function applyPreset(context: ModelsContext, prompts: ConfigModelsPrompts, statuses: readonly ChainAvailability[], pending: Pending): Promise<boolean> {
  const preset = await prompts.promptPreset()
  if (preset === null) return false
  const chains = buildPreset({
    preset,
    agents: statuses.map((status) => status.agent),
    available: context.state.models,
    catalog: context.state.catalog,
  })
  if (chains.size === 0) {
    context.output(preset === "local"
      ? "No local models are usable in OpenCode yet. Connect your Ollama models first."
      : "No models match this preset right now.")
    return true
  }
  return acceptSuggestions(prompts, chains, pending)
}

async function connectOllama(context: ModelsContext, prompts: ConfigModelsPrompts): Promise<boolean> {
  const models = unconnectedOllamaModels(context.state)
  const confirmed = await prompts.promptConnectOllama(models, context.openCodeConfigPath)
  if (confirmed === null) return false
  if (!confirmed) return true
  const result = connectOllamaModels({ path: context.openCodeConfigPath, baseUrl: context.state.ollama.baseUrl, models })
  context.output(`wrote ${result.path}${result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`}`)
  context.state.models = [...context.state.models, ...models.map(ollamaModelId)].sort((left, right) => left.localeCompare(right))
  return true
}

async function saveChanges(context: ModelsContext, prompts: ConfigModelsPrompts, pending: Pending): Promise<number> {
  const edits: OmoConfigEdit[] = []
  for (const [agent, chain] of pending) {
    edits.push(...chainEdits(agent, buildChainEntries(chain, readAgentChain(context.section.agents[agent]))))
  }
  const summary = [formatChainSummary(pending)]

  if (!isRuntimeFallbackEnabled(context.section.runtimeFallback)) {
    const enable = context.enableRuntimeFallback ?? await prompts.promptEnableRuntimeFallback()
    if (enable === null) return 1
    if (enable) {
      edits.push(runtimeFallbackEdit())
      summary.push("runtime_fallback   on")
    }
  }

  if (edits.length === 0) {
    context.output("Nothing changed.")
    return 0
  }
  const confirmed = await prompts.promptConfirmWrite(summary.filter((line) => line.length > 0).join("\n"))
  if (confirmed !== true) return 1
  writeEdits(context, edits)
  return 0
}

export async function runInteractive(context: ModelsContext, prompts: ConfigModelsPrompts): Promise<number> {
  printStatuses(context, statusesFor(context))
  const pending: Pending = new Map()

  for (;;) {
    const statuses = statusesFor(context)
    const action = await prompts.promptMainMenu({
      statuses,
      pending,
      source: context.state.source,
      unconnectedOllama: unconnectedOllamaModels(context.state).length,
    })
    if (action === null || action === "exit") return action === null ? 1 : 0
    if (action === "save") return saveChanges(context, prompts, pending)

    let completed = true
    if (action === "fix-broken") completed = await acceptSuggestions(prompts, brokenSuggestions(context, statuses, pending), pending)
    if (action === "preset") completed = await applyPreset(context, prompts, statuses, pending)
    if (action === "connect-ollama") completed = await connectOllama(context, prompts)
    if (action === "source") {
      const source = await prompts.promptSource(context.state.source)
      completed = source !== null
      if (source !== null) context.state.source = source
    }
    if (action === "one") {
      const agent = await prompts.promptAgent({ statuses, pending })
      completed = agent !== null && await configureAgent(context, prompts, agent, pending)
    }
    if (action === "all") {
      for (const status of statuses) {
        completed = await configureAgent(context, prompts, status.agent, pending)
        if (!completed) break
      }
    }
    if (!completed) return 1
  }
}

