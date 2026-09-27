import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { getOpenCodeCacheDir, parseJsonc } from "../../shared"

export type AvailableModelsSource = "opencode-cli" | "models-cache" | "none"

export type AvailableModels = {
  readonly models: readonly string[]
  readonly source: AvailableModelsSource
}

export type ListAvailableModelsOptions = {
  readonly runOpenCodeModels?: () => string | null
  readonly readModelsCache?: () => string | null
}

const MODEL_ID_PATTERN = /^[\w.@-]+\/\S+$/

function defaultRunOpenCodeModels(): string | null {
  try {
    const result = spawnSync("opencode", ["models"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 60_000 })
    return result.status === 0 ? result.stdout : null
  } catch {
    return null
  }
}

function defaultReadModelsCache(): string | null {
  const cacheFile = join(getOpenCodeCacheDir(), "models.json")
  return existsSync(cacheFile) ? readFileSync(cacheFile, "utf-8") : null
}

export function parseOpenCodeModelsOutput(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => MODEL_ID_PATTERN.test(line))
}

export function parseModelsCache(content: string): string[] {
  const data = parseJsonc<Record<string, { models?: Record<string, unknown> }>>(content)
  const models: string[] = []
  for (const [providerId, provider] of Object.entries(data ?? {})) {
    for (const modelId of Object.keys(provider?.models ?? {})) models.push(`${providerId}/${modelId}`)
  }
  return models
}

function unique(models: readonly string[]): string[] {
  return [...new Set(models)].sort((left, right) => left.localeCompare(right))
}

/**
 * `opencode models` only lists models of providers the user can actually reach right now,
 * so it is preferred. The models.dev cache lists every known model and is only a fallback.
 */
export function listAvailableModels(options: ListAvailableModelsOptions = {}): AvailableModels {
  const cliOutput = (options.runOpenCodeModels ?? defaultRunOpenCodeModels)()
  if (cliOutput !== null) {
    const models = parseOpenCodeModelsOutput(cliOutput)
    if (models.length > 0) return { models: unique(models), source: "opencode-cli" }
  }

  const cacheContent = (options.readModelsCache ?? defaultReadModelsCache)()
  if (cacheContent !== null) {
    try {
      const models = parseModelsCache(cacheContent)
      if (models.length > 0) return { models: unique(models), source: "models-cache" }
    } catch {
      return { models: [], source: "none" }
    }
  }

  return { models: [], source: "none" }
}
