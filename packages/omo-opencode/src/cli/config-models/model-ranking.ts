import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { getAgentProfile } from "./agent-profiles"
import type { AgentProfile } from "./agent-profiles"
import { formatTokens, isFree } from "./model-catalog"
import { SMALL_LOCAL_MODEL_BILLIONS } from "./ollama"
import type { ModelCatalog, ModelInfo } from "./model-catalog"

export type RankedModel = {
  readonly model: string
  readonly score: number
  readonly info: ModelInfo | undefined
  readonly recommendedRank: number | undefined
  readonly warnings: readonly string[]
}

const RECOMMENDED_BONUS = 15
const UNSUITABLE_FACTOR = 0.3
const MIN_CONTEXT = 32_000
const MAX_CONTEXT = 1_000_000
const MAX_PRICE_PER_MILLION = 100
const RECENCY_WINDOW_MONTHS = 24
const SUGGESTION_POOL = 10
const NO_METADATA_WARNING = "no metadata in models.dev cache"
const SPECIALIZED_MODEL_PATTERN = /guard|safety|moderation|embed|rerank|tts|whisper|orpheus|transcribe|image-gen/i

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function contextScore(tokens: number | undefined): number {
  if (tokens === undefined) return 0
  return clamp(Math.log2(tokens / MIN_CONTEXT) / Math.log2(MAX_CONTEXT / MIN_CONTEXT))
}

function cheapScore(info: ModelInfo): number {
  if (isFree(info)) return 1
  if (info.costInput === undefined) return 0.5
  const price = info.costInput + (info.costOutput ?? info.costInput)
  return clamp(1 - Math.log10(1 + price) / Math.log10(1 + MAX_PRICE_PER_MILLION))
}

function recencyScore(releaseDate: string | undefined, now: Date): number {
  if (releaseDate === undefined) return 0
  const released = new Date(releaseDate)
  if (Number.isNaN(released.getTime())) return 0
  const ageMonths = (now.getTime() - released.getTime()) / (1000 * 60 * 60 * 24 * 30)
  return clamp(1 - ageMonths / RECENCY_WINDOW_MONTHS)
}

function baseModelName(model: string): string {
  const name = model.slice(model.lastIndexOf("/") + 1).toLowerCase()
  return name.replace(/:free$/, "").replace(/-free$/, "")
}

/** Position of the model in the plugin's own hand-tuned chain for this agent (0 = its first choice). */
export function recommendedRankFor(agent: string, model: string): number | undefined {
  const chain = AGENT_MODEL_REQUIREMENTS[agent]?.fallbackChain ?? []
  const provider = model.slice(0, model.indexOf("/"))
  const base = baseModelName(model)
  const index = chain.findIndex((entry) =>
    (base === entry.model || base.startsWith(`${entry.model}-`)) && (entry.providers.includes(provider) || provider === "openrouter"),
  )
  return index === -1 ? undefined : index
}

function warningsFor(profile: AgentProfile, info: ModelInfo | undefined): string[] {
  if (info === undefined) return [NO_METADATA_WARNING]
  const warnings: string[] = []
  if (SPECIALIZED_MODEL_PATTERN.test(info.id)) warnings.push("not a general chat model (safety/speech/embedding)")
  if (!info.toolCall) warnings.push("no tool calling: agents cannot use tools")
  if (profile.needsImageInput && !info.inputModalities.includes("image")) warnings.push("no image input")
  if (info.parameterBillions !== undefined && info.parameterBillions < SMALL_LOCAL_MODEL_BILLIONS) {
    warnings.push(`small local model (${Number(info.parameterBillions.toFixed(1))}B): often fails at tool use`)
  }
  if (info.contextTokens !== undefined && info.contextTokens < MIN_CONTEXT) {
    warnings.push(`small context (${formatTokens(info.contextTokens)})`)
  }
  return warnings
}

export function scoreModel(agent: string, model: string, info: ModelInfo | undefined, now: Date = new Date()): RankedModel {
  const profile = getAgentProfile(agent)
  const recommendedRank = recommendedRankFor(agent, model)
  const bonus = recommendedRank === undefined ? 0 : Math.max(5, RECOMMENDED_BONUS - recommendedRank * 2)
  const { weights } = profile
  const maxPoints = weights.reasoning + weights.context + weights.cheap + weights.recent + RECOMMENDED_BONUS
  const warnings = warningsFor(profile, info)

  const points = info === undefined
    ? bonus
    : (info.reasoning ? weights.reasoning : 0)
      + weights.context * contextScore(info.contextTokens)
      + weights.cheap * cheapScore(info)
      + weights.recent * recencyScore(info.releaseDate, now)
      + bonus

  const unsuitable = info !== undefined && warnings.some((warning) => warning.startsWith("no ") || warning.startsWith("not "))
  const score = Math.round((points / maxPoints) * 100 * (unsuitable ? UNSUITABLE_FACTOR : 1))
  return { model, score, info, recommendedRank, warnings }
}

export function rankModels(
  agent: string,
  models: readonly string[],
  catalog: ModelCatalog,
  now: Date = new Date(),
): RankedModel[] {
  return models
    .map((model) => scoreModel(agent, model, catalog.get(model), now))
    .sort((left, right) => right.score - left.score || left.model.localeCompare(right.model))
}

function providerOf(model: string): string {
  return model.slice(0, model.indexOf("/"))
}

/**
 * Best models without warnings; within the top of the ranking, fallbacks prefer providers not used
 * yet, so one provider outage or quota limit does not take down the whole chain.
 */
export function suggestChain(ranked: readonly RankedModel[], size = 3): string[] {
  const candidates = ranked.filter((entry) => entry.warnings.every((warning) => warning === NO_METADATA_WARNING))
  const pool = (candidates.length > 0 ? candidates : ranked).slice(0, SUGGESTION_POOL)
  const chain: RankedModel[] = []
  while (chain.length < size && chain.length < pool.length) {
    const used = new Set(chain.map((entry) => providerOf(entry.model)))
    const next = pool.find((entry) => !chain.includes(entry) && !used.has(providerOf(entry.model)))
      ?? pool.find((entry) => !chain.includes(entry))
    if (next === undefined) break
    chain.push(next)
  }
  return chain.map((entry) => entry.model)
}
