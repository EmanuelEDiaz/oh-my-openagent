import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { getOmoOpenCodeCacheDir } from "../../shared/data-path"
import { writeFileAtomically } from "../../shared/write-file-atomically"

export type BenchmarkFacts = {
  readonly source: "Artificial Analysis"
  readonly name: string
  readonly intelligenceIndex: number | undefined
  readonly codingIndex: number | undefined
  readonly agenticIndex: number | undefined
  readonly outputTokensPerSecond: number | undefined
  readonly timeToFirstTokenSeconds: number | undefined
}

export type OpenRouterModelFacts = {
  readonly description: string | undefined
  readonly contextLength: number | undefined
  readonly supportsTools: boolean
}

export type ReliabilityFacts = {
  readonly source: "OpenRouter"
  readonly providers: number
  readonly bestUptimeLastDay: number | undefined
}

export type ExternalData = {
  readonly fetchedAt: string
  readonly benchmarks: Readonly<Record<string, BenchmarkFacts>>
  readonly openRouter: Readonly<Record<string, OpenRouterModelFacts>>
}

export type FetchJson = (url: string, headers?: Readonly<Record<string, string>>) => Promise<unknown>

const CACHE_FILE = "model-insights.json"
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 8000
const AA_URL = "https://artificialanalysis.ai/api/v2/language/models/free"
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function numberAt(record: unknown, key: string): number | undefined {
  if (!isRecord(record)) return undefined
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

async function defaultFetchJson(url: string, headers?: Readonly<Record<string, string>>): Promise<unknown> {
  const response = await fetch(url, { headers: headers ?? {}, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.json()
}

/**
 * Exact-match key: lowercase model name without provider path, `:free`/`-free` suffix or punctuation.
 * Used on both sides so benchmark data is only attached when the names really match.
 */
export function matchKey(modelIdOrSlug: string): string {
  const name = modelIdOrSlug.slice(modelIdOrSlug.lastIndexOf("/") + 1).toLowerCase()
  return name.replace(/:free$/, "").replace(/-free$/, "").replace(/[^a-z0-9]/g, "")
}

export function parseArtificialAnalysis(payload: unknown): Record<string, BenchmarkFacts> {
  const rows = isRecord(payload) && Array.isArray(payload["data"]) ? payload["data"] : []
  const result: Record<string, BenchmarkFacts> = {}
  for (const row of rows) {
    if (!isRecord(row) || typeof row["slug"] !== "string") continue
    const key = matchKey(row["slug"])
    if (result[key] !== undefined) continue
    result[key] = {
      source: "Artificial Analysis",
      name: typeof row["name"] === "string" ? row["name"] : row["slug"],
      intelligenceIndex: numberAt(row["evaluations"], "artificial_analysis_intelligence_index"),
      codingIndex: numberAt(row["evaluations"], "artificial_analysis_coding_index"),
      agenticIndex: numberAt(row["evaluations"], "artificial_analysis_agentic_index"),
      outputTokensPerSecond: numberAt(row["performance"], "median_output_tokens_per_second"),
      timeToFirstTokenSeconds: numberAt(row["performance"], "median_time_to_first_token_seconds"),
    }
  }
  return result
}

export function parseOpenRouterModels(payload: unknown): Record<string, OpenRouterModelFacts> {
  const rows = isRecord(payload) && Array.isArray(payload["data"]) ? payload["data"] : []
  const result: Record<string, OpenRouterModelFacts> = {}
  for (const row of rows) {
    if (!isRecord(row) || typeof row["id"] !== "string") continue
    const parameters = Array.isArray(row["supported_parameters"]) ? row["supported_parameters"] : []
    result[row["id"]] = {
      description: typeof row["description"] === "string" ? row["description"] : undefined,
      contextLength: numberAt(row, "context_length"),
      supportsTools: parameters.includes("tools"),
    }
  }
  return result
}

export function parseOpenRouterEndpoints(payload: unknown): ReliabilityFacts | undefined {
  const data = isRecord(payload) && isRecord(payload["data"]) ? payload["data"] : undefined
  const endpoints = data !== undefined && Array.isArray(data["endpoints"]) ? data["endpoints"] : []
  if (endpoints.length === 0) return undefined
  const uptimes = endpoints.map((endpoint) => numberAt(endpoint, "uptime_last_1d")).filter((value): value is number => value !== undefined)
  return {
    source: "OpenRouter",
    providers: endpoints.length,
    bestUptimeLastDay: uptimes.length === 0 ? undefined : Math.max(...uptimes),
  }
}

export type ExternalDataStore = {
  readonly load: () => Promise<ExternalData>
  readonly reliability: (openRouterModelId: string) => Promise<ReliabilityFacts | undefined>
}

export function createExternalDataStore(options: {
  readonly fetchJson?: FetchJson
  readonly cachePath?: string
  readonly artificialAnalysisKey?: string | undefined
  readonly now?: () => number
} = {}): ExternalDataStore {
  const fetchJson = options.fetchJson ?? defaultFetchJson
  const cachePath = options.cachePath ?? join(getOmoOpenCodeCacheDir(), CACHE_FILE)
  const now = options.now ?? Date.now
  const key = options.artificialAnalysisKey
  let pending: Promise<ExternalData> | undefined

  const readCache = (): ExternalData | undefined => {
    try {
      if (!existsSync(cachePath)) return undefined
      const cached = JSON.parse(readFileSync(cachePath, "utf-8")) as ExternalData
      const fresh = now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS
      const hasBenchmarksIfKey = key === undefined || Object.keys(cached.benchmarks).length > 0
      return fresh && hasBenchmarksIfKey ? cached : undefined
    } catch {
      return undefined
    }
  }

  const refresh = async (): Promise<ExternalData> => {
    const [openRouter, benchmarks] = await Promise.all([
      fetchJson(OPENROUTER_MODELS_URL).then(parseOpenRouterModels).catch(() => ({})),
      key === undefined
        ? Promise.resolve({})
        : fetchJson(AA_URL, { "x-api-key": key }).then(parseArtificialAnalysis).catch(() => ({})),
    ])
    const data: ExternalData = { fetchedAt: new Date(now()).toISOString(), benchmarks, openRouter }
    try {
      mkdirSync(dirname(cachePath), { recursive: true })
      writeFileAtomically(cachePath, JSON.stringify(data))
    } catch {
      return data
    }
    return data
  }

  return {
    load: () => {
      pending ??= Promise.resolve(readCache() ?? refresh())
      return pending
    },
    reliability: (openRouterModelId) => {
      const [author, ...rest] = openRouterModelId.split("/")
      const slug = rest.join("/")
      if (!author || slug.length === 0) return Promise.resolve(undefined)
      return fetchJson(`https://openrouter.ai/api/v1/models/${author}/${slug}/endpoints`)
        .then(parseOpenRouterEndpoints)
        .catch(() => undefined)
    },
  }
}
