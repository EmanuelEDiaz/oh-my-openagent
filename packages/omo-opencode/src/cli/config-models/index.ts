import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { OmoConfigEdit } from "@oh-my-opencode/omo-config-core"

import { parseJsonc } from "../../shared"
import {
  buildChainEntries,
  checkChainAvailability,
  isConfigurableAgent,
  readAgentChain,
  readAgentChains,
} from "./agent-chains"
import type { ChainAvailability, ModelChainEntry } from "./agent-chains"
import { listAvailableModels } from "./available-models"
import type { AvailableModels } from "./available-models"
import { formatRankingTable } from "./format"
import { loadModelCatalog } from "./model-catalog"
import type { ModelCatalog } from "./model-catalog"
import { rankModels } from "./model-ranking"
import type { RankedModel } from "./model-ranking"
import * as defaultPrompts from "./prompts"

export type ConfigModelsScope = "user" | "project"

export type ConfigModelsPrompts = {
  readonly promptMode: typeof defaultPrompts.promptMode
  readonly promptAgents: typeof defaultPrompts.promptAgents
  readonly promptChain: typeof defaultPrompts.promptChain
  readonly promptEnableRuntimeFallback: typeof defaultPrompts.promptEnableRuntimeFallback
  readonly promptConfirmWrite: typeof defaultPrompts.promptConfirmWrite
}

export type ConfigModelsOptions = {
  readonly check?: boolean
  readonly rank?: string
  readonly top?: number
  readonly agent?: string
  readonly models?: readonly string[]
  readonly allowUnavailable?: boolean
  readonly enableRuntimeFallback?: boolean
  readonly scope?: ConfigModelsScope
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly json?: boolean
  readonly output?: (line: string) => void
  readonly isInteractive?: () => boolean
  readonly listModels?: () => AvailableModels
  readonly loadCatalog?: () => ModelCatalog
  readonly prompts?: ConfigModelsPrompts
}

type OpenCodeSection = {
  readonly agents: Readonly<Record<string, unknown>>
  readonly runtimeFallback: unknown
  readonly disabledProviders: readonly string[]
}

type ModelsContext = {
  readonly options: ConfigModelsOptions
  readonly output: (line: string) => void
  readonly configPath: string
  readonly section: OpenCodeSection
  readonly available: AvailableModels
  readonly availableSet: ReadonlySet<string>
  readonly catalog: ModelCatalog
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function resolveConfigPath(scope: ConfigModelsScope, cwd: string, env: ConfigModelsOptions["env"]): string {
  const jsoncPath = scope === "user"
    ? resolveUserOmoConfigPath(env ?? process.env)
    : join(cwd, ".omo", "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

function readOpenCodeSection(path: string): OpenCodeSection {
  if (!existsSync(path)) return { agents: {}, runtimeFallback: undefined, disabledProviders: [] }
  const document = parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))
  const section = isRecord(document?.["[opencode]"]) ? document["[opencode]"] : {}
  return {
    agents: isRecord(section["agents"]) ? section["agents"] : {},
    runtimeFallback: section["runtime_fallback"],
    disabledProviders: Array.isArray(section["disabled_providers"])
      ? section["disabled_providers"].filter((entry): entry is string => typeof entry === "string")
      : [],
  }
}

function withoutDisabledProviders(available: AvailableModels, disabled: readonly string[]): AvailableModels {
  if (disabled.length === 0) return available
  const blocked = new Set(disabled)
  return { ...available, models: available.models.filter((model) => !blocked.has(model.slice(0, model.indexOf("/")))) }
}

function isRuntimeFallbackEnabled(value: unknown): boolean {
  if (value === true) return true
  return isRecord(value) && value["enabled"] !== false
}

function describeSource(available: AvailableModels): string {
  if (available.source === "opencode-cli") return "`opencode models` (providers connected right now)"
  if (available.source === "models-cache") return "models.dev cache (connection status unknown; run `opencode models --refresh`)"
  return "no source"
}

function statusesFor(context: ModelsContext): ChainAvailability[] {
  return readAgentChains(context.section.agents).map((chain) => checkChainAvailability(chain, context.availableSet))
}

function statusLabel(status: ChainAvailability): string {
  if (status.models.length === 0) return "omo default"
  if (status.firstAvailable === undefined) return "BROKEN"
  return status.missing.length > 0 ? "missing" : "ok"
}

function printStatuses(context: ModelsContext, statuses: readonly ChainAvailability[]): void {
  const { output } = context
  const excluded = context.section.disabledProviders
  output(`Config:  ${context.configPath}`)
  output(`Models:  ${context.available.models.length} available now, from ${describeSource(context.available)}`)
  if (excluded.length > 0) output(`         excluded by disabled_providers: ${excluded.join(", ")}`)
  output(`Mid-session fallback (runtime_fallback): ${isRuntimeFallbackEnabled(context.section.runtimeFallback) ? "on" : "off"}`)
  output("")
  output(`${"Agent".padEnd(19)}${"Status".padEnd(13)}Model chain (first = primary)`)
  for (const status of statuses) {
    const chain = status.models.length === 0
      ? "-"
      : status.models.map((model) => (status.missing.includes(model) ? `${model} (gone)` : model)).join("  >  ")
    output(`${status.agent.padEnd(19)}${statusLabel(status).padEnd(13)}${chain}`)
  }
  output("")
}

function chainEdits(agent: string, entries: readonly ModelChainEntry[]): OmoConfigEdit[] {
  const agentPath = ["[opencode]", "agents", agent]
  return [
    { path: [...agentPath, "models"], value: entries },
    { path: [...agentPath, "model"], value: undefined },
    { path: [...agentPath, "fallback_models"], value: undefined },
  ]
}

function writeEdits(context: ModelsContext, edits: readonly OmoConfigEdit[]): void {
  const scope = context.options.scope ?? "user"
  const result = updateOmoConfig({
    edits,
    scope,
    ...(scope === "project" ? { projectDir: context.options.cwd ?? process.cwd() } : {}),
    ...(context.options.env === undefined ? {} : { env: context.options.env }),
  })
  context.output(`wrote ${result.path}${result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`}`)
}

function runtimeFallbackEdit(): OmoConfigEdit {
  return { path: ["[opencode]", "runtime_fallback"], value: true }
}

function runCheck(context: ModelsContext): number {
  const statuses = statusesFor(context)
  if (context.options.json) {
    context.output(JSON.stringify({
      configPath: context.configPath,
      source: context.available.source,
      availableCount: context.available.models.length,
      runtimeFallback: isRuntimeFallbackEnabled(context.section.runtimeFallback),
      agents: statuses,
    }, null, 2))
  } else {
    printStatuses(context, statuses)
  }
  return statuses.some((status) => status.models.length > 0 && status.firstAvailable === undefined) ? 1 : 0
}

function rankingJson(entry: RankedModel): Record<string, unknown> {
  return {
    model: entry.model,
    score: entry.score,
    recommendedRank: entry.recommendedRank,
    warnings: entry.warnings,
    info: entry.info,
  }
}

function runRank(context: ModelsContext, agent: string): number {
  const top = context.options.top ?? 20
  const ranked = rankModels(agent, context.available.models, context.catalog)
  if (context.options.json) {
    context.output(JSON.stringify({ agent, ranking: ranked.slice(0, top).map(rankingJson) }, null, 2))
    return 0
  }
  context.output(formatRankingTable(ranked, top))
  return 0
}

function runSet(context: ModelsContext, agent: string, models: readonly string[]): number {
  const unknown = models.filter((model) => !context.availableSet.has(model))
  if (unknown.length > 0 && !context.options.allowUnavailable) {
    context.output(`error: not available right now: ${unknown.join(", ")} (use --allow-unavailable to write anyway)`)
    return 1
  }
  const entries = buildChainEntries(models, readAgentChain(context.section.agents[agent]))
  const edits = chainEdits(agent, entries)
  if (context.options.enableRuntimeFallback && !isRuntimeFallbackEnabled(context.section.runtimeFallback)) {
    edits.push(runtimeFallbackEdit())
  }
  writeEdits(context, edits)
  context.output(`${agent}: ${models.join(" -> ")}`)
  return 0
}

async function runInteractive(context: ModelsContext, prompts: ConfigModelsPrompts): Promise<number> {
  const statuses = statusesFor(context)
  printStatuses(context, statuses)

  const mode = await prompts.promptMode()
  if (mode === null) return 1
  const agents = await prompts.promptAgents(statuses)
  if (agents === null) return 1

  const edits: OmoConfigEdit[] = []
  const summary: string[] = []
  for (const agent of agents) {
    const previous = readAgentChain(context.section.agents[agent])
    const current = previous.map((entry) => (typeof entry === "string" ? entry : entry.model))
    const ranked = rankModels(agent, context.available.models, context.catalog)
    const chain = await prompts.promptChain({ agent, mode, ranked, current })
    if (chain === null) return 1
    if (chain.length === 0) continue
    edits.push(...chainEdits(agent, buildChainEntries(chain, previous)))
    summary.push(`${agent.padEnd(19)}${chain.join("  >  ")}`)
  }

  if (!isRuntimeFallbackEnabled(context.section.runtimeFallback)) {
    const enable = context.options.enableRuntimeFallback ?? await prompts.promptEnableRuntimeFallback()
    if (enable === null) return 1
    if (enable) {
      edits.push(runtimeFallbackEdit())
      summary.push("runtime_fallback  on")
    }
  }

  if (edits.length === 0) {
    context.output("Nothing changed.")
    return 0
  }
  const confirmed = await prompts.promptConfirmWrite(summary.join("\n"))
  if (confirmed !== true) return 1
  writeEdits(context, edits)
  return 0
}

export async function runConfigModels(options: ConfigModelsOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const cwd = options.cwd ?? process.cwd()
  const configPath = resolveConfigPath(options.scope ?? "user", cwd, options.env)

  let section: OpenCodeSection
  try {
    section = readOpenCodeSection(configPath)
  } catch (error) {
    output(`error: cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const available = withoutDisabledProviders((options.listModels ?? listAvailableModels)(), section.disabledProviders)
  const context: ModelsContext = {
    options,
    output,
    configPath,
    section,
    available,
    availableSet: new Set(available.models),
    catalog: (options.loadCatalog ?? loadModelCatalog)(),
  }

  if (options.check) return runCheck(context)

  if (available.models.length === 0) {
    output("error: no models found. Run `opencode models --refresh` or connect a provider with `opencode auth login`.")
    return 1
  }

  const requestedAgent = options.rank ?? options.agent
  if (requestedAgent !== undefined && !isConfigurableAgent(requestedAgent)) {
    output(`error: unknown oh-my-openagent agent "${requestedAgent}". Known: ${readAgentChains({}).map((chain) => chain.agent).join(", ")}`)
    return 1
  }

  if (options.rank !== undefined) return runRank(context, options.rank)

  if (options.agent !== undefined || options.models !== undefined) {
    if (options.agent === undefined || options.models === undefined || options.models.length === 0) {
      output("error: --agent and --models must be used together")
      return 1
    }
    return runSet(context, options.agent, options.models)
  }

  const isInteractive = options.isInteractive ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY))
  if (!isInteractive()) {
    output("error: interactive mode needs a TTY. Use --check, or --agent <name> --models <a,b,c>.")
    return 1
  }
  return runInteractive(context, options.prompts ?? defaultPrompts)
}
