import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeCacheDir, parseJsonc } from "../../shared"

export type ModelInfo = {
  readonly id: string
  readonly name: string
  readonly description: string | undefined
  readonly family: string | undefined
  readonly contextTokens: number | undefined
  readonly outputTokens: number | undefined
  readonly inputModalities: readonly string[]
  readonly reasoning: boolean
  readonly toolCall: boolean
  readonly costInput: number | undefined
  readonly costOutput: number | undefined
  readonly releaseDate: string | undefined
  readonly knowledge: string | undefined
  readonly openWeights: boolean
}

export type ModelCatalog = ReadonlyMap<string, ModelInfo>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function numberAt(record: unknown, key: string): number | undefined {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringAt(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function toModelInfo(id: string, raw: Record<string, unknown>): ModelInfo {
  const modalities = isRecord(raw["modalities"]) ? raw["modalities"] : {}
  const input = Array.isArray(modalities["input"])
    ? modalities["input"].filter((entry): entry is string => typeof entry === "string")
    : []
  return {
    id,
    name: stringAt(raw, "name") ?? id,
    description: stringAt(raw, "description"),
    family: stringAt(raw, "family"),
    contextTokens: numberAt(raw["limit"], "context"),
    outputTokens: numberAt(raw["limit"], "output"),
    inputModalities: input.length > 0 ? input : ["text"],
    reasoning: raw["reasoning"] === true,
    toolCall: raw["tool_call"] === true,
    costInput: numberAt(raw["cost"], "input"),
    costOutput: numberAt(raw["cost"], "output"),
    releaseDate: stringAt(raw, "release_date"),
    knowledge: stringAt(raw, "knowledge"),
    openWeights: raw["open_weights"] === true,
  }
}

/** Keys are `provider/modelId`, the same ids `opencode models` prints (modelId may contain `/`). */
export function parseModelCatalog(content: string): Map<string, ModelInfo> {
  const data = parseJsonc<Record<string, unknown>>(content)
  const catalog = new Map<string, ModelInfo>()
  for (const [providerId, provider] of Object.entries(isRecord(data) ? data : {})) {
    if (!isRecord(provider) || !isRecord(provider["models"])) continue
    for (const [modelId, raw] of Object.entries(provider["models"])) {
      if (!isRecord(raw)) continue
      const id = `${providerId}/${modelId}`
      catalog.set(id, toModelInfo(id, raw))
    }
  }
  return catalog
}

export function loadModelCatalog(readCache: () => string | null = defaultReadCache): ModelCatalog {
  try {
    const content = readCache()
    return content === null ? new Map() : parseModelCatalog(content)
  } catch {
    return new Map()
  }
}

function defaultReadCache(): string | null {
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")
  return existsSync(cacheFile) ? readFileSync(cacheFile, "utf-8") : null
}

export function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined) return "?"
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`
  return String(tokens)
}

export function isFree(info: ModelInfo): boolean {
  return info.costInput === 0 && (info.costOutput === undefined || info.costOutput === 0)
}

export function formatCost(info: ModelInfo): string {
  if (info.costInput === undefined) return "cost ?"
  if (isFree(info)) return "free"
  return `$${info.costInput}/$${info.costOutput ?? "?"} per 1M`
}
