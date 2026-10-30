import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { parseModelString } from "./model-string-parser"
import { getOmoOpenCodeCacheDir } from "./data-path"
import { log } from "./logger"
import { writeFileAtomically } from "./write-file-atomically"

/**
 * Models a provider lists but does not serve (fork plan real-use-incidents A2): a `model_not_found` answer marks the
 * model here for 24 h, so the /omo-models picker shows it as "not served", model resolution skips it and the fallback
 * chains step over it. The file is re-read on every lookup because the TUI and the server run in separate processes.
 * A network cut never lands here: only a provider answer that the model does not exist does.
 */
export const BROKEN_MODEL_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_FILE = "broken-models.json"

type BrokenEntry = { readonly at: string; readonly reason: string }
type BrokenFile = { readonly models: Readonly<Record<string, BrokenEntry>> }

export type BrokenModelsOptions = {
  readonly cacheDir?: string
  readonly now?: () => number
}

function cachePath(options: BrokenModelsOptions): string {
  return join(options.cacheDir ?? getOmoOpenCodeCacheDir(), CACHE_FILE)
}

/** `provider/model`, without a variant suffix; undefined for strings that are not a model id. */
export function brokenModelKey(model: string): string | undefined {
  const parsed = parseModelString(model)
  return parsed ? `${parsed.providerID}/${parsed.modelID}` : undefined
}

function readFile(options: BrokenModelsOptions): Record<string, BrokenEntry> {
  const path = cachePath(options)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<BrokenFile>
    return parsed.models && typeof parsed.models === "object" ? { ...parsed.models } : {}
  } catch (error) {
    log("[broken-models] cache unreadable, ignoring it", { path, error: String(error) })
    return {}
  }
}

function isFresh(entry: BrokenEntry | undefined, now: number): boolean {
  if (!entry) return false
  const at = Date.parse(entry.at)
  return Number.isFinite(at) && now - at < BROKEN_MODEL_TTL_MS
}

/** Models marked as not served in the last 24 h. */
export function listBrokenModels(options: BrokenModelsOptions = {}): Set<string> {
  const now = (options.now ?? Date.now)()
  const models = readFile(options)
  return new Set(Object.keys(models).filter((model) => isFresh(models[model], now)))
}

export function isModelBroken(model: string, options: BrokenModelsOptions = {}): boolean {
  const key = brokenModelKey(model)
  return key !== undefined && listBrokenModels(options).has(key)
}

/** The set without the models marked not served (same set back when none are). */
export function withoutBrokenModels(models: Set<string>, options: BrokenModelsOptions = {}): Set<string> {
  const broken = listBrokenModels(options)
  if (broken.size === 0) return models
  return new Set([...models].filter((model) => !broken.has(brokenModelKey(model) ?? model)))
}

/** Records a model the provider answered "not found / no route" for; stale entries are dropped on the way. */
export function markModelBroken(model: string, reason: string, options: BrokenModelsOptions = {}): void {
  const key = brokenModelKey(model)
  if (!key) return
  const now = (options.now ?? Date.now)()
  try {
    const current = readFile(options)
    const kept = Object.fromEntries(Object.entries(current).filter(([, entry]) => isFresh(entry, now)))
    kept[key] = { at: new Date(now).toISOString(), reason: reason.slice(0, 300) }
    const dir = options.cacheDir ?? getOmoOpenCodeCacheDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileAtomically(cachePath(options), `${JSON.stringify({ models: kept }, null, 2)}\n`)
    log("[broken-models] model marked as not served", { model: key, reason })
  } catch (error) {
    log("[broken-models] could not record broken model", { model: key, error: String(error) })
  }
}
