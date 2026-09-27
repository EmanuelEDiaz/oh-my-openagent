import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { OmoConfigEdit } from "@oh-my-opencode/omo-config-core"

import { parseJsonc } from "../../shared"
import { checkChainAvailability, readAgentChain, readAgentChains } from "./agent-chains"
import type { ChainAvailability, ModelChainEntry } from "./agent-chains"
import type { AvailableModelsSource } from "./available-models"
import type { ModelCatalog, ModelInfo } from "./model-catalog"
import { rankModels } from "./model-ranking"
import type { RankedModel } from "./model-ranking"
import { filterBySource } from "./model-sources"
import type { ModelSource } from "./model-sources"
import { OLLAMA_DETECTION_OFF, ollamaModelId, toOllamaModelInfo } from "./ollama"
import type { OllamaDetection, OllamaModel } from "./ollama"

export type ConfigModelsScope = "user" | "project"

export type OpenCodeSection = {
  readonly agents: Readonly<Record<string, unknown>>
  readonly runtimeFallback: unknown
  readonly disabledProviders: readonly string[]
}

/** Mutable session state: the source filter and the model list can change while the menu runs. */
export type ModelsState = {
  source: ModelSource
  models: string[]
  catalog: Map<string, ModelInfo>
  ollama: OllamaDetection
}

export type ModelsContext = {
  readonly output: (line: string) => void
  readonly configPath: string
  readonly openCodeConfigPath: string
  readonly scope: ConfigModelsScope
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>> | undefined
  readonly enableRuntimeFallback: boolean | undefined
  readonly section: OpenCodeSection
  readonly listingSource: AvailableModelsSource
  readonly state: ModelsState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function resolveConfigPath(scope: ConfigModelsScope, cwd: string, env: ModelsContext["env"]): string {
  const jsoncPath = scope === "user"
    ? resolveUserOmoConfigPath(env ?? process.env)
    : join(cwd, ".omo", "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

export function readOpenCodeSection(path: string): OpenCodeSection {
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

export function withoutDisabledProviders(models: readonly string[], disabled: readonly string[]): string[] {
  const blocked = new Set(disabled)
  return models.filter((model) => !blocked.has(model.slice(0, model.indexOf("/"))))
}

/** Adds Ollama metadata to the catalog (models.dev does not know local models). */
export function withOllamaMetadata(catalog: ModelCatalog, ollama: OllamaDetection): Map<string, ModelInfo> {
  const merged = new Map(catalog)
  for (const model of ollama.models) merged.set(ollamaModelId(model), toOllamaModelInfo(model))
  return merged
}

/** Installed in Ollama but not declared in opencode.json, so OpenCode cannot use them yet. */
export function unconnectedOllamaModels(state: ModelsState): OllamaModel[] {
  const available = new Set(state.models)
  return state.ollama.models.filter((model) => !available.has(ollamaModelId(model)))
}

export function isRuntimeFallbackEnabled(value: unknown): boolean {
  if (value === true) return true
  return isRecord(value) && value["enabled"] !== false
}

export function statusesFor(context: ModelsContext): ChainAvailability[] {
  const available = new Set(context.state.models)
  return readAgentChains(context.section.agents).map((chain) => checkChainAvailability(chain, available))
}

export function currentModels(context: ModelsContext, agent: string): string[] {
  return readAgentChain(context.section.agents[agent]).map((entry) => (typeof entry === "string" ? entry : entry.model))
}

/** Ranked models of the current source; falls back to every model when the source has none. */
export function rankForAgent(context: ModelsContext, agent: string, source: ModelSource = context.state.source): RankedModel[] {
  const filtered = filterBySource(context.state.models, source, context.state.catalog)
  const pool = filtered.length > 0 ? filtered : context.state.models
  return rankModels(agent, pool, context.state.catalog)
}

function statusLabel(status: ChainAvailability): string {
  if (status.models.length === 0) return "omo default"
  if (status.firstAvailable === undefined) return "BROKEN"
  return status.missing.length > 0 ? "missing" : "ok"
}

function describeListing(source: AvailableModelsSource): string {
  if (source === "opencode-cli") return "`opencode models` (providers connected right now)"
  if (source === "models-cache") return "models.dev cache (connection status unknown; run `opencode models --refresh`)"
  return "no source"
}

function describeOllama(context: ModelsContext): string {
  const { ollama } = context.state
  if (ollama.baseUrl === OLLAMA_DETECTION_OFF) return "detection disabled (OMO_OLLAMA_URL=off)"
  if (!ollama.reachable) return `not detected at ${ollama.baseUrl}`
  const unconnected = unconnectedOllamaModels(context.state).length
  const connected = ollama.models.length - unconnected
  return `${ollama.models.length} installed, ${connected} usable in OpenCode${unconnected > 0 ? `, ${unconnected} not connected yet` : ""}`
}

export function printStatuses(context: ModelsContext, statuses: readonly ChainAvailability[]): void {
  const { output } = context
  const excluded = context.section.disabledProviders
  output(`Config:  ${context.configPath}`)
  output(`Models:  ${context.state.models.length} available now, from ${describeListing(context.listingSource)}`)
  if (excluded.length > 0) output(`         excluded by disabled_providers: ${excluded.join(", ")}`)
  output(`Ollama:  ${describeOllama(context)}`)
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

export function chainEdits(agent: string, entries: readonly ModelChainEntry[]): OmoConfigEdit[] {
  const agentPath = ["[opencode]", "agents", agent]
  return [
    { path: [...agentPath, "models"], value: entries },
    { path: [...agentPath, "model"], value: undefined },
    { path: [...agentPath, "fallback_models"], value: undefined },
  ]
}

export function runtimeFallbackEdit(): OmoConfigEdit {
  return { path: ["[opencode]", "runtime_fallback"], value: true }
}

export function writeEdits(context: ModelsContext, edits: readonly OmoConfigEdit[]): void {
  const result = updateOmoConfig({
    edits,
    scope: context.scope,
    ...(context.scope === "project" ? { projectDir: context.cwd } : {}),
    ...(context.env === undefined ? {} : { env: context.env }),
  })
  context.output(`wrote ${result.path}${result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`}`)
}

export function formatChainSummary(chains: ReadonlyMap<string, readonly string[]>): string {
  return [...chains].map(([agent, chain]) => `${agent.padEnd(19)}${chain.join("  >  ")}`).join("\n")
}
