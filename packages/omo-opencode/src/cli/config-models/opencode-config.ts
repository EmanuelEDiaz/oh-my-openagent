import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { updateOmoConfig } from "@oh-my-opencode/omo-config-core"

import { parseJsonc } from "../../shared"
import { buildOllamaProviderConfig } from "./ollama"
import type { OllamaModel } from "./ollama"

type Env = Readonly<Record<string, string | undefined>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function resolveOpenCodeConfigPath(env: Env = process.env): string {
  const configDir = env["XDG_CONFIG_HOME"]
    ? join(env["XDG_CONFIG_HOME"], "opencode")
    : join(env["HOME"] ?? homedir(), ".config", "opencode")
  const jsonc = join(configDir, "opencode.jsonc")
  return existsSync(jsonc) ? jsonc : join(configDir, "opencode.json")
}

/** Model names already declared under `provider.ollama.models` in opencode.json. */
export function readConfiguredOllamaModels(path: string): string[] {
  if (!existsSync(path)) return []
  try {
    const document = parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))
    const provider = isRecord(document?.["provider"]) ? document["provider"] : {}
    const ollama = isRecord(provider["ollama"]) ? provider["ollama"] : {}
    return isRecord(ollama["models"]) ? Object.keys(ollama["models"]) : []
  } catch {
    return []
  }
}

/**
 * Declares the given Ollama models in opencode.json so OpenCode can use them. Other providers and
 * any hand-written ollama settings are kept; only missing model entries are added.
 */
export function connectOllamaModels(params: {
  readonly path: string
  readonly baseUrl: string
  readonly models: readonly OllamaModel[]
}): { readonly path: string; readonly backupPath?: string } {
  const configured = new Set(readConfiguredOllamaModels(params.path))
  const block = buildOllamaProviderConfig(params.baseUrl, params.models)
  const edits = configured.size === 0
    ? [{ path: ["provider", "ollama"], value: block }]
    : params.models
      .filter((model) => !configured.has(model.name))
      .map((model) => ({
        path: ["provider", "ollama", "models", model.name],
        value: (block["models"] as Record<string, unknown>)[model.name],
      }))
  return updateOmoConfig({ edits, scope: "user", targetPath: params.path })
}
