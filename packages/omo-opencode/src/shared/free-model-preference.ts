import type { ModelCatalog } from "../cli/config-models/model-catalog"
import { isFree, loadModelCatalog } from "../cli/config-models/model-catalog"

/**
 * Fork roadmap 0.5: "prefer free models". Only automatic picks consult this (fallback chains, builtin category
 * defaults, the connected-provider fallback); models the user chose in /omo-models or the config always win.
 */
let enabled = false
let catalog: ModelCatalog | undefined
let paidOnlyProviders: Set<string> | undefined
let loadCatalog: () => ModelCatalog = () => loadModelCatalog()

export function setPreferFreeModels(value: boolean, loader?: () => ModelCatalog): void {
  enabled = value
  catalog = undefined
  paidOnlyProviders = undefined
  if (loader) loadCatalog = loader
}

/** Providers whose priced models in the cache are all paid (e.g. openai): none of their models is free. */
function providersWithoutFreeModels(models: ModelCatalog): Set<string> {
  const priced = new Map<string, boolean>()
  for (const [id, info] of models) {
    if (info.costInput === undefined) continue
    const provider = id.split("/")[0] ?? ""
    priced.set(provider, (priced.get(provider) ?? false) || isFree(info))
  }
  return new Set([...priced].filter(([, hasFree]) => !hasFree).map(([provider]) => provider))
}

/**
 * A model is paid when OpenCode's model cache lists a non-zero price for it, or when it is missing from the cache but
 * its provider offers no free model at all. `*-free` ids and providers absent from the cache (local ones such as
 * ollama) are never treated as paid, so the preference cannot hide a usable free model.
 */
export function isPaidModel(model: string): boolean {
  if (!enabled) return false
  const id = model.trim()
  if (/-free$/i.test(id)) return false
  catalog ??= loadCatalog()
  const info = catalog.get(id)
  if (info && info.costInput !== undefined) return !isFree(info)
  paidOnlyProviders ??= providersWithoutFreeModels(catalog)
  return paidOnlyProviders.has(id.split("/")[0] ?? "")
}

/** The check to hand to resolvers, or undefined when the preference is off (upstream behaviour). */
export function paidModelCheck(): ((model: string) => boolean) | undefined {
  return enabled ? isPaidModel : undefined
}
