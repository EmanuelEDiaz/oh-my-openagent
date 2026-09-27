import { writeConnectedProvidersCache, writeProviderModelsCache } from "../../shared"

export type PluginModelCacheWriter = {
  readonly writeConnected: (connected: string[]) => void
  readonly writeModels: (data: { models: Record<string, string[]>; connected: string[] }) => void
}

const DEFAULT_WRITER: PluginModelCacheWriter = {
  writeConnected: writeConnectedProvidersCache,
  writeModels: writeProviderModelsCache,
}

export function groupModelsByProvider(models: readonly string[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}
  for (const model of models) {
    const slash = model.indexOf("/")
    if (slash <= 0) continue
    const provider = model.slice(0, slash)
    grouped[provider] = [...(grouped[provider] ?? []), model.slice(slash + 1)]
  }
  return grouped
}

/**
 * The plugin resolves agent models at startup from its own provider cache, which it only builds
 * after a TUI session starts (never under `opencode run`). Without it the first model of every
 * chain is used blindly, even if it no longer exists. Seeding it from `opencode models` lets
 * startup resolution skip missing models on the very next launch.
 */
export function seedPluginModelCache(models: readonly string[], writer: PluginModelCacheWriter = DEFAULT_WRITER): number {
  const grouped = groupModelsByProvider(models)
  const connected = Object.keys(grouped).sort()
  if (connected.length === 0) return 0
  writer.writeConnected(connected)
  writer.writeModels({ models: grouped, connected })
  return connected.length
}
