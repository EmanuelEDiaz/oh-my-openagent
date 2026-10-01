import type { ModelCatalog } from "../cli/config-models/model-catalog"
import { isFree, loadModelCatalog } from "../cli/config-models/model-catalog"

/**
 * Fork roadmap 0.5: "prefer free models". Only automatic picks consult this (fallback chains, builtin category
 * defaults, the connected-provider fallback); models the user chose in /omo-models or the config always win.
 */
let enabled = false
let catalog: ModelCatalog | undefined
let loadCatalog: () => ModelCatalog = () => loadModelCatalog()

export function setPreferFreeModels(value: boolean, loader?: () => ModelCatalog): void {
  enabled = value
  catalog = undefined
  if (loader) loadCatalog = loader
}

/**
 * A model is paid only when OpenCode's model cache lists a non-zero price for it. Unknown models (local providers,
 * models missing from the cache) and `*-free` ids are never treated as paid, so the preference cannot hide a usable model.
 */
export function isPaidModel(model: string): boolean {
  if (!enabled) return false
  const id = model.trim()
  if (/-free$/i.test(id)) return false
  catalog ??= loadCatalog()
  const info = catalog.get(id)
  if (!info || info.costInput === undefined) return false
  return !isFree(info)
}

/** The check to hand to resolvers, or undefined when the preference is off (upstream behaviour). */
export function paidModelCheck(): ((model: string) => boolean) | undefined {
  return enabled ? isPaidModel : undefined
}
