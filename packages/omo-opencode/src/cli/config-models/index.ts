import { buildChainEntries, entryModel, isConfigurableAgent, readAgentChain, readAgentChains, CONFIGURABLE_AGENTS } from "./agent-chains"
import { listBrokenModels } from "../../shared/broken-models-cache"
import { listAvailableModels } from "./available-models"
import type { AvailableModels } from "./available-models"
import {
  chainEdits,
  formatChainSummary,
  isRuntimeFallbackEnabled,
  isRuntimeFallbackExplicitlyOn,
  printStatuses,
  rankForAgent,
  readOpenCodeSection,
  resolveConfigPath,
  runtimeFallbackEdit,
  statusesFor,
  unconnectedOllamaModels,
  withOllamaMetadata,
  withoutDisabledProviders,
  writeEdits,
} from "./context"
import type { ConfigModelsScope, ModelsContext, OpenCodeSection } from "./context"
import type { OmoConfigEdit } from "@oh-my-opencode/omo-config-core"
import { formatRankingTable } from "./format"
import { runInteractive } from "./interactive"
import type { ConfigModelsPrompts } from "./interactive"
import { loadModelCatalog } from "./model-catalog"
import type { ModelCatalog } from "./model-catalog"
import type { RankedModel } from "./model-ranking"
import type { ModelSource } from "./model-sources"
import { detectOllama, ollamaModelId, resolveOllamaUrl } from "./ollama"
import type { OllamaDetection } from "./ollama"
import { connectOllamaModels, resolveOpenCodeConfigPath } from "./opencode-config"
import { seedPluginModelCache } from "./plugin-model-cache"
import { buildPreset } from "./presets"
import type { PresetName } from "./presets"
import * as defaultPrompts from "./prompts"

export type { ConfigModelsPrompts } from "./interactive"
export type { ConfigModelsScope } from "./context"

export type ConfigModelsOptions = {
  readonly check?: boolean
  readonly rank?: string
  readonly top?: number
  readonly source?: ModelSource
  readonly preset?: PresetName
  readonly connectOllama?: boolean
  readonly agent?: string
  readonly models?: readonly string[]
  readonly allowUnavailable?: boolean
  readonly enableRuntimeFallback?: boolean
  /** Drop retired and not-served models from every agent chain (the file is backed up first). */
  readonly prune?: boolean
  readonly notServed?: () => ReadonlySet<string>
  readonly scope?: ConfigModelsScope
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly json?: boolean
  readonly output?: (line: string) => void
  readonly isInteractive?: () => boolean
  readonly listModels?: () => AvailableModels
  readonly loadCatalog?: () => ModelCatalog
  readonly seedCache?: (models: readonly string[]) => number
  readonly detectLocal?: () => Promise<OllamaDetection>
  readonly openCodeConfigPath?: string
  readonly prompts?: ConfigModelsPrompts
}

function runCheck(context: ModelsContext, json: boolean): number {
  const statuses = statusesFor(context)
  if (json) {
    context.output(JSON.stringify({
      configPath: context.configPath,
      source: context.listingSource,
      availableCount: context.state.models.length,
      runtimeFallback: isRuntimeFallbackEnabled(context.section.runtimeFallback),
      ollama: { reachable: context.state.ollama.reachable, unconnected: unconnectedOllamaModels(context.state).map((model) => model.name) },
      agents: statuses,
    }, null, 2))
  } else {
    printStatuses(context, statuses)
  }
  return statuses.some((status) => status.models.length > 0 && status.firstAvailable === undefined) ? 1 : 0
}

function rankingJson(entry: RankedModel): Record<string, unknown> {
  return { model: entry.model, score: entry.score, recommendedRank: entry.recommendedRank, warnings: entry.warnings, info: entry.info }
}

function runRank(context: ModelsContext, agent: string, top: number, json: boolean): number {
  const ranked = rankForAgent(context, agent)
  context.output(json
    ? JSON.stringify({ agent, source: context.state.source, ranking: ranked.slice(0, top).map(rankingJson) }, null, 2)
    : formatRankingTable(ranked, top))
  return 0
}

function writeChains(context: ModelsContext, chains: ReadonlyMap<string, readonly string[]>): number {
  const edits = [...chains].flatMap(([agent, chain]) =>
    chainEdits(agent, buildChainEntries(chain, readAgentChain(context.section.agents[agent]))),
  )
  if (context.enableRuntimeFallback && !isRuntimeFallbackExplicitlyOn(context.section.runtimeFallback)) edits.push(runtimeFallbackEdit())
  writeEdits(context, edits)
  context.output(formatChainSummary(chains))
  return 0
}

function runSet(context: ModelsContext, agent: string, models: readonly string[], allowUnavailable: boolean): number {
  const available = new Set(context.state.models)
  const unknown = models.filter((model) => !available.has(model))
  if (unknown.length > 0 && !allowUnavailable) {
    context.output(`error: not available right now: ${unknown.join(", ")} (use --allow-unavailable to write anyway)`)
    return 1
  }
  return writeChains(context, new Map([[agent, models]]))
}

function runPreset(context: ModelsContext, preset: PresetName): number {
  const chains = buildPreset({ preset, agents: CONFIGURABLE_AGENTS, available: context.state.models, catalog: context.state.catalog })
  if (chains.size === 0) {
    context.output(`error: no available models match the "${preset}" preset${preset === "local" ? " (connect Ollama first: --connect-ollama)" : ""}`)
    return 1
  }
  return writeChains(context, chains)
}

/**
 * Removes from every agent chain the models that are no longer listed or were not served in the last 24 h (fork plan
 * real-use-incidents A4). A chain left empty is removed, so the agent goes back to omo's defaults. updateOmoConfig
 * writes a backup of the previous file.
 */
function runPrune(context: ModelsContext, notServed: ReadonlySet<string>): number {
  const available = new Set(context.state.models)
  const isDead = (model: string) => !available.has(model) || notServed.has(model)
  const edits: OmoConfigEdit[] = []
  const report: string[] = []
  for (const agent of CONFIGURABLE_AGENTS) {
    const entries = readAgentChain(context.section.agents[agent])
    const dead = entries.map(entryModel).filter(isDead)
    if (dead.length === 0) continue
    const kept = entries.filter((entry) => !isDead(entryModel(entry)))
    edits.push(...chainEdits(agent, kept).map((edit) => (kept.length === 0 ? { ...edit, value: undefined } : edit)))
    report.push(`${agent.padEnd(19)}removed ${dead.join(", ")}${kept.length === 0 ? " (chain empty: omo default)" : ""}`)
  }
  if (edits.length === 0) {
    context.output("No retired or not-served models in the agent chains.")
    return 0
  }
  writeEdits(context, edits)
  for (const line of report) context.output(line)
  return 0
}

function runConnectOllama(context: ModelsContext): number {
  const models = unconnectedOllamaModels(context.state)
  if (!context.state.ollama.reachable) {
    context.output(`error: Ollama not detected at ${context.state.ollama.baseUrl} (set OMO_OLLAMA_URL or OLLAMA_HOST)`)
    return 1
  }
  if (models.length === 0) {
    context.output("All installed Ollama models are already usable in OpenCode.")
    return 0
  }
  const result = connectOllamaModels({ path: context.openCodeConfigPath, baseUrl: context.state.ollama.baseUrl, models })
  context.output(`wrote ${result.path}${result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`}`)
  context.output(`connected: ${models.map(ollamaModelId).join(", ")}`)
  return 0
}

async function buildContext(options: ConfigModelsOptions, section: OpenCodeSection, configPath: string): Promise<ModelsContext> {
  const output = options.output ?? console.log
  const env = options.env
  if (!options.json) output("Listing the models available right now (opencode models), this can take a few seconds...")
  const listed = (options.listModels ?? listAvailableModels)()
  if (listed.source === "opencode-cli") {
    const providers = (options.seedCache ?? seedPluginModelCache)(listed.models)
    if (providers > 0 && !options.json) output(`Plugin model cache refreshed (${providers} providers), so missing models are skipped at startup.`)
  }
  const ollama = await (options.detectLocal ?? (() => detectOllama({ baseUrl: resolveOllamaUrl(env ?? process.env) })))()
  return {
    output,
    configPath,
    openCodeConfigPath: options.openCodeConfigPath ?? resolveOpenCodeConfigPath(env ?? process.env),
    scope: options.scope ?? "user",
    cwd: options.cwd ?? process.cwd(),
    env,
    enableRuntimeFallback: options.enableRuntimeFallback,
    section,
    listingSource: listed.source,
    state: {
      source: options.source ?? "all",
      models: withoutDisabledProviders(listed.models, section.disabledProviders),
      catalog: withOllamaMetadata((options.loadCatalog ?? loadModelCatalog)(), ollama),
      ollama,
    },
  }
}

export async function runConfigModels(options: ConfigModelsOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const configPath = resolveConfigPath(options.scope ?? "user", options.cwd ?? process.cwd(), options.env)

  let section: OpenCodeSection
  try {
    section = readOpenCodeSection(configPath)
  } catch (error) {
    output(`error: cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const context = await buildContext(options, section, configPath)
  const json = options.json ?? false

  if (options.check) return runCheck(context, json)
  if (options.connectOllama) return runConnectOllama(context)

  if (context.state.models.length === 0) {
    output("error: no models found. Run `opencode models --refresh` or connect a provider with `opencode auth login`.")
    return 1
  }

  const requestedAgent = options.rank ?? options.agent
  if (requestedAgent !== undefined && !isConfigurableAgent(requestedAgent)) {
    output(`error: unknown oh-my-openagent agent "${requestedAgent}". Known: ${readAgentChains({}).map((chain) => chain.agent).join(", ")}`)
    return 1
  }

  if (options.prune) return runPrune(context, (options.notServed ?? listBrokenModels)())
  if (options.rank !== undefined) return runRank(context, options.rank, options.top ?? 20, json)
  if (options.preset !== undefined) return runPreset(context, options.preset)

  if (options.agent !== undefined || options.models !== undefined) {
    if (options.agent === undefined || options.models === undefined || options.models.length === 0) {
      output("error: --agent and --models must be used together")
      return 1
    }
    return runSet(context, options.agent, options.models, options.allowUnavailable ?? false)
  }

  const isInteractive = options.isInteractive ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY))
  if (!isInteractive()) {
    output("error: interactive mode needs a TTY. Use --check, --preset <free|local|mixed>, or --agent <name> --models <a,b,c>.")
    return 1
  }
  return runInteractive(context, options.prompts ?? defaultPrompts)
}
