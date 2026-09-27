import type { ModelCatalog } from "./model-catalog"
import { rankModels, suggestChain } from "./model-ranking"
import type { RankedModel } from "./model-ranking"
import { filterBySource, isLocalModel } from "./model-sources"

export type PresetName = "free" | "local" | "mixed"

/** Agents called many times per task: cheapest to run locally. */
const LOCAL_FIRST_AGENTS: ReadonlySet<string> = new Set(["explore", "librarian"])

export const PRESET_DESCRIPTIONS: Readonly<Record<PresetName, string>> = {
  free: "every agent uses free models (OpenCode Zen free, :free); cloud fallbacks from different providers",
  local: "every agent uses your Ollama models only (offline, private; small models may struggle)",
  mixed: "explore/librarian run locally first; the rest use free cloud models; a local model is the last fallback everywhere",
}

/** Models within this many points of the best are treated as equally good when spreading primaries. */
const PRIMARY_SPREAD_POINTS = 3

/**
 * Free tiers rate-limit per model and agents run in parallel, so similar-scoring primaries are
 * spread across agents instead of sending every agent to the same model.
 */
function spreadPrimary(ranked: readonly RankedModel[], chain: readonly string[], primaryUse: Map<string, number>): string[] {
  const best = ranked.find((entry) => entry.model === chain[0])
  if (best === undefined) return [...chain]
  const peers = ranked.filter((entry) => entry.warnings.length === 0 && best.score - entry.score <= PRIMARY_SPREAD_POINTS)
  const leastUsed = [...peers].sort((left, right) => (primaryUse.get(left.model) ?? 0) - (primaryUse.get(right.model) ?? 0))[0]
  if (leastUsed === undefined || leastUsed.model === chain[0]) return [...chain]
  return [leastUsed.model, ...chain.filter((model) => model !== leastUsed.model)].slice(0, chain.length)
}

function withLastResort(chain: readonly string[], lastResort: string | undefined, size: number): string[] {
  if (lastResort === undefined || chain.includes(lastResort)) return [...chain]
  return [...chain.slice(0, size - 1), lastResort]
}

/**
 * Builds one chain per agent from the models available now. Agents without any matching model are
 * left out (the caller keeps their current config).
 */
export function buildPreset(params: {
  readonly preset: PresetName
  readonly agents: readonly string[]
  readonly available: readonly string[]
  readonly catalog: ModelCatalog
  readonly size?: number
}): Map<string, string[]> {
  const size = params.size ?? 3
  const free = filterBySource(params.available, "free", params.catalog)
  const cloudFree = free.filter((model) => !isLocalModel(model))
  const local = filterBySource(params.available, "local", params.catalog)
  const chains = new Map<string, string[]>()
  const primaryUse = new Map<string, number>()

  for (const agent of params.agents) {
    const pick = (pool: readonly string[], count: number): string[] => {
      if (pool.length === 0) return []
      const ranked = rankModels(agent, pool, params.catalog)
      return spreadPrimary(ranked, suggestChain(ranked, count), primaryUse)
    }
    const bestLocal = pick(local, 1)[0]

    let chain: string[]
    if (params.preset === "local") chain = pick(local, size)
    else if (params.preset === "free") chain = pick(cloudFree.length > 0 ? cloudFree : free, size)
    else if (LOCAL_FIRST_AGENTS.has(agent) && bestLocal !== undefined) chain = [bestLocal, ...pick(cloudFree, size - 1)]
    else chain = withLastResort(pick(cloudFree, size), bestLocal, size)

    if (chain.length === 0) continue
    chains.set(agent, chain)
    primaryUse.set(chain[0] ?? "", (primaryUse.get(chain[0] ?? "") ?? 0) + 1)
  }
  return chains
}
