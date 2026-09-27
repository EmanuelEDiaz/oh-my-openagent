import { isFree } from "./model-catalog"
import type { ModelCatalog } from "./model-catalog"

export type ModelSource = "free" | "local" | "all"

const LOCAL_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "lmstudio", "llama.cpp", "llamacpp", "local"])
const FREE_SUFFIX_PATTERN = /(?:-free|:free)$/

export function providerOf(model: string): string {
  return model.slice(0, model.indexOf("/"))
}

export function isLocalModel(model: string): boolean {
  return LOCAL_PROVIDERS.has(providerOf(model))
}

/** Free = costs nothing per token: local models, `*-free`/`:free` ids, or $0 in the models.dev catalog. */
export function isFreeModel(model: string, catalog: ModelCatalog): boolean {
  if (isLocalModel(model) || FREE_SUFFIX_PATTERN.test(model)) return true
  const info = catalog.get(model)
  return info !== undefined && isFree(info)
}

export function filterBySource(models: readonly string[], source: ModelSource, catalog: ModelCatalog): string[] {
  if (source === "local") return models.filter(isLocalModel)
  if (source === "free") return models.filter((model) => isFreeModel(model, catalog))
  return [...models]
}

export function describeSource(source: ModelSource): string {
  if (source === "free") return "free models (OpenCode Zen free, :free, local)"
  if (source === "local") return "local models (Ollama)"
  return "all available models"
}
