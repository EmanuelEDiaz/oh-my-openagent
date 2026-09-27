import type { ModelInfo } from "./model-catalog"

export type OllamaModel = {
  readonly name: string
  readonly contextTokens: number | undefined
  readonly parameterBillions: number | undefined
  readonly capabilities: readonly string[]
}

export type OllamaDetection = {
  readonly baseUrl: string
  readonly reachable: boolean
  readonly models: readonly OllamaModel[]
}

export type FetchJson = (url: string, body?: unknown) => Promise<unknown>

const DEFAULT_OLLAMA_URL = "http://localhost:11434"
export const OLLAMA_DETECTION_OFF = "off"
const REQUEST_TIMEOUT_MS = 1500
/** Below this size local models rarely follow agent tool-calling instructions reliably. */
export const SMALL_LOCAL_MODEL_BILLIONS = 7

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** `OMO_OLLAMA_URL=off` disables detection; otherwise OMO_OLLAMA_URL, then OLLAMA_HOST, then localhost. */
export function resolveOllamaUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const configured = env["OMO_OLLAMA_URL"] ?? env["OLLAMA_HOST"]
  if (configured === "off") return null
  if (configured === undefined || configured.length === 0) return DEFAULT_OLLAMA_URL
  const withScheme = configured.startsWith("http") ? configured : `http://${configured}`
  return withScheme.replace(/\/+$/, "")
}

async function defaultFetchJson(url: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** "3.8B" -> 3.8, "807.00M" -> 0.807 */
export function parseParameterSize(size: unknown): number | undefined {
  if (typeof size !== "string") return undefined
  const match = /^([\d.]+)\s*([BbMm])$/.exec(size.trim())
  if (!match?.[1] || !match[2]) return undefined
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) return undefined
  return match[2].toLowerCase() === "m" ? value / 1000 : value
}

function contextFromModelInfo(modelInfo: unknown): number | undefined {
  if (!isRecord(modelInfo)) return undefined
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith(".context_length") && typeof value === "number") return value
  }
  return undefined
}

async function describeModel(baseUrl: string, name: string, fetchJson: FetchJson): Promise<OllamaModel> {
  try {
    const show = await fetchJson(`${baseUrl}/api/show`, { model: name })
    const record = isRecord(show) ? show : {}
    const details = isRecord(record["details"]) ? record["details"] : {}
    const capabilities = Array.isArray(record["capabilities"])
      ? record["capabilities"].filter((entry): entry is string => typeof entry === "string")
      : []
    return {
      name,
      contextTokens: contextFromModelInfo(record["model_info"]),
      parameterBillions: parseParameterSize(details["parameter_size"]),
      capabilities,
    }
  } catch {
    return { name, contextTokens: undefined, parameterBillions: undefined, capabilities: [] }
  }
}

export async function detectOllama(options: {
  readonly baseUrl: string | null
  readonly fetchJson?: FetchJson
}): Promise<OllamaDetection> {
  if (options.baseUrl === null) return { baseUrl: OLLAMA_DETECTION_OFF, reachable: false, models: [] }
  const { baseUrl } = options
  const fetchJson = options.fetchJson ?? defaultFetchJson
  try {
    const tags = await fetchJson(`${baseUrl}/api/tags`)
    const entries = isRecord(tags) && Array.isArray(tags["models"]) ? tags["models"] : []
    const names = entries
      .map((entry) => (isRecord(entry) && typeof entry["name"] === "string" ? entry["name"] : undefined))
      .filter((name): name is string => name !== undefined)
    const models = await Promise.all(names.map((name) => describeModel(baseUrl, name, fetchJson)))
    return { baseUrl, reachable: true, models }
  } catch {
    return { baseUrl, reachable: false, models: [] }
  }
}

export function ollamaModelId(model: OllamaModel): string {
  return `ollama/${model.name}`
}

export function toOllamaModelInfo(model: OllamaModel): ModelInfo {
  const size = model.parameterBillions === undefined ? "" : ` (${Number(model.parameterBillions.toFixed(1))}B parameters)`
  return {
    id: ollamaModelId(model),
    name: model.name,
    description: `Local Ollama model${size}. Runs on this machine: free, private, works offline; speed depends on your hardware.`,
    family: undefined,
    contextTokens: model.contextTokens,
    outputTokens: undefined,
    inputModalities: model.capabilities.includes("vision") ? ["text", "image"] : ["text"],
    reasoning: model.capabilities.includes("thinking"),
    toolCall: model.capabilities.length === 0 || model.capabilities.includes("tools"),
    costInput: 0,
    costOutput: 0,
    releaseDate: undefined,
    knowledge: undefined,
    openWeights: true,
    parameterBillions: model.parameterBillions,
  }
}

/** OpenCode provider block for Ollama's OpenAI-compatible endpoint (per OpenCode's provider docs). */
export function buildOllamaProviderConfig(baseUrl: string, models: readonly OllamaModel[]): Record<string, unknown> {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Ollama (local)",
    options: { baseURL: `${baseUrl}/v1` },
    models: Object.fromEntries(models.map((model) => [
      model.name,
      {
        name: model.name,
        ...(model.contextTokens === undefined ? {} : { limit: { context: model.contextTokens, output: Math.min(8192, model.contextTokens) } }),
      },
    ])),
  }
}
