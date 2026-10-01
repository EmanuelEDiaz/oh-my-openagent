import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigPaths,
  getPluginEntryName,
  parseJsonc,
  type PluginEntry,
} from "../../../shared"

export interface PluginInfo {
  registered: boolean
  configPath: string | null
  entry: PluginEntry | null
  isPinned: boolean
  pinnedVersion: string | null
  isLocalDev: boolean
}

interface OpenCodeConfigShape {
  plugin?: PluginEntry[]
}

function detectConfigPath(): string | null {
  const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  if (existsSync(paths.configJsonc)) return paths.configJsonc
  if (existsSync(paths.configJson)) return paths.configJson
  return null
}

function parsePluginVersion(entry: PluginEntry): string | null {
  const name = getPluginEntryName(entry)
  if (name.startsWith(`${PLUGIN_NAME}@`)) {
    const value = name.slice(PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  if (name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    const value = name.slice(LEGACY_PLUGIN_NAME.length + 1)
    if (!value || value === "latest") return null
    return value
  }
  return null
}

const MAX_PACKAGE_LOOKUP_DEPTH = 6

/**
 * A `file://` entry is this plugin when, after resolving symlinks, an ancestor package.json is named like it. Forks are
 * often checked out or linked under other names (e.g. `~/.config/opencode/omo-fork`), so the path text alone is not
 * enough (fork roadmap 0.6).
 */
function isPluginCheckout(fileUrl: string): boolean {
  try {
    let directory = dirname(realpathSync(fileURLToPath(fileUrl)))
    for (let depth = 0; depth < MAX_PACKAGE_LOOKUP_DEPTH; depth++) {
      const manifest = join(directory, "package.json")
      if (existsSync(manifest)) {
        const name = (JSON.parse(readFileSync(manifest, "utf-8")) as { name?: unknown }).name
        if (name === PLUGIN_NAME || name === LEGACY_PLUGIN_NAME) return true
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {
    return false
  }
  return false
}

function findPluginEntry(entries: PluginEntry[]): { entry: PluginEntry; isLocalDev: boolean } | null {
  for (const entry of entries) {
    const name = getPluginEntryName(entry)
    if (name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    if (name === LEGACY_PLUGIN_NAME || name.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
      return { entry, isLocalDev: false }
    }
    if (name.startsWith("file://") && (name.includes(PLUGIN_NAME) || name.includes(LEGACY_PLUGIN_NAME) || isPluginCheckout(name))) {
      return { entry, isLocalDev: true }
    }
  }

  return null
}

export function getPluginInfo(): PluginInfo {
  const configPath = detectConfigPath()
  if (!configPath) {
    return {
      registered: false,
      configPath: null,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
      isLocalDev: false,
    }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const parsedConfig = parseJsonc<OpenCodeConfigShape>(content)
    const pluginEntry = findPluginEntry(parsedConfig.plugin ?? [])
    if (!pluginEntry) {
      return {
        registered: false,
        configPath,
        entry: null,
        isPinned: false,
        pinnedVersion: null,
        isLocalDev: false,
      }
    }

    const pinnedVersion = parsePluginVersion(pluginEntry.entry)
    return {
      registered: true,
      configPath,
      entry: pluginEntry.entry,
      isPinned: pinnedVersion !== null && /^\d+\.\d+\.\d+/.test(pinnedVersion ?? ""),
      pinnedVersion,
      isLocalDev: pluginEntry.isLocalDev,
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }

    return {
      registered: false,
      configPath,
      entry: null,
      isPinned: false,
      pinnedVersion: null,
      isLocalDev: false,
    }
  }
}

export { detectConfigPath, findPluginEntry }
