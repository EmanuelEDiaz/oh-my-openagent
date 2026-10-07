import { recordAgentRegistrationIssue } from "../shared/agent-registration-report"
import { listBrokenModels } from "../shared/broken-models-cache"
import { readProviderModelsCache } from "../shared/connected-providers-cache"
import type { ProviderModelsCache } from "../shared/connected-providers-cache"
import { isPaidModel } from "../shared/free-model-preference"
import { log } from "../shared/logger"

/**
 * Session titles and summaries run on OpenCode's `small_model`; unset, OpenCode picks a paid one (opencode/gpt-5.4-nano)
 * even for a user who asked for free models (fork plan real-use-incidents A5, roadmap 0.14). With prefer_free_models on
 * and no explicit small_model, the plugin sets the first free, active, served model, preferring small/fast ones. An
 * explicit small_model is never changed; a paid or not-served one only gets a startup warning.
 */
const SMALL_NAME = /(?:nano|mini|flash|lightning|small|lite|haiku)/i
const FREE_ID = /(?:-free|:free)$/i
/** OpenCode Zen first: its free models need no extra key and are what the free-models preference is built around. */
const ZEN = "opencode"

type Candidate = { readonly id: string; readonly preferred: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isFreeEntry(id: string, entry: unknown): boolean {
  if (FREE_ID.test(id)) return true
  if (!isRecord(entry) || !isRecord(entry["cost"])) return false
  return entry["cost"]["input"] === 0 && (entry["cost"]["output"] ?? 0) === 0
}

function isRetired(entry: unknown): boolean {
  return isRecord(entry) && typeof entry["status"] === "string" && entry["status"] !== "active" && entry["status"] !== "beta"
}

export function pickFreeSmallModel(cache: ProviderModelsCache | null, broken: ReadonlySet<string>): string | undefined {
  if (!cache) return undefined
  const providers = cache.connected.length > 0 ? cache.connected : Object.keys(cache.models)
  const candidates: Candidate[] = []
  for (const provider of providers) {
    for (const entry of cache.models[provider] ?? []) {
      const modelID = typeof entry === "string" ? entry : entry.id
      if (typeof modelID !== "string" || modelID.length === 0) continue
      const id = `${provider}/${modelID}`
      if (!isFreeEntry(modelID, entry) || isRetired(entry) || broken.has(id)) continue
      candidates.push({ id, preferred: SMALL_NAME.test(modelID) })
    }
  }
  const rank = (candidate: Candidate) => (candidate.id.startsWith(`${ZEN}/`) ? 0 : 2) + (candidate.preferred ? 0 : 1)
  return [...candidates].sort((left, right) => rank(left) - rank(right))[0]?.id
}

export function applySmallModelDefault(input: {
  readonly config: Record<string, unknown>
  readonly preferFreeModels: boolean
  readonly readCache?: () => ProviderModelsCache | null
  readonly brokenModels?: () => ReadonlySet<string>
  readonly isPaid?: (model: string) => boolean
}): void {
  if (!input.preferFreeModels) return
  const broken = (input.brokenModels ?? listBrokenModels)()
  const explicit = input.config["small_model"]
  if (typeof explicit === "string" && explicit.length > 0) {
    const paid = (input.isPaid ?? isPaidModel)(explicit)
    if (paid || broken.has(explicit)) {
      recordAgentRegistrationIssue({
        agent: "small_model",
        status: "notice",
        detail: `small_model ${explicit} is ${paid ? "paid" : "not served right now"}; session titles use it although prefer_free_models is on (kept: it is your choice).`,
      })
    }
    return
  }
  const picked = pickFreeSmallModel((input.readCache ?? readProviderModelsCache)(), broken)
  if (!picked) return
  input.config["small_model"] = picked
  log("[small-model] small_model set to a free model (prefer_free_models)", { model: picked })
}
