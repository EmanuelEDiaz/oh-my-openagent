import { statSync } from "node:fs"

import { readAgentChain } from "../../cli/config-models/agent-chains"
import type { ModelChainEntry } from "../../cli/config-models/agent-chains"
import { readOpenCodeSection, resolveConfigPath } from "../../cli/config-models/context"
import type { OpenCodeSection } from "../../cli/config-models/context"
import { isRetiredModel, loadModelCatalog } from "../../cli/config-models/model-catalog"
import type { ModelCatalog } from "../../cli/config-models/model-catalog"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { isModelBroken } from "../../shared/broken-models-cache"
import { wasFallbackSwitch } from "../../shared/fallback-switched-models"
import { getLoadedAgentModel } from "../../shared/loaded-agent-models"
import { log } from "../../shared/logger"
import { parseModelString } from "../../shared/model-string-parser"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "./types"

/**
 * /omo-models applies without restarting OpenCode (fork plan real-use-incidents A1). The TUI picks the model itself
 * (its in-memory per-agent pick, else the agent's startup model, else its most recent model) and sends it with every
 * prompt, so a chain saved after startup never reaches the server on its own. On each user message this checks
 * whether ~/.omo/omo.jsonc changed since startup; if the agent's chain changed, the message is moved to the new
 * primary unless the model it carries is a deliberate user pick. Not deliberate: the startup model, a primary the
 * agent had in an earlier omo.jsonc version, a model the plugin's own fallback switched to, or (when the startup
 * model is retired, so the TUI substituted its most recent model) the stand-in the TUI first sent for the agent.
 * Anything else is a `/models` choice and is left alone, as is a project-level chain (which wins over the user file).
 */
export type LiveAgentModelDeps = {
  readonly userConfigPath: string
  readonly projectConfigPath?: string
  readonly modifiedAt: (path: string) => number | undefined
  readonly read: (path: string) => OpenCodeSection
  readonly loadedModel: (agentConfigKey: string) => string | undefined
  readonly isBroken: (model: string) => boolean
  /** Deprecated by the provider or no longer listed: OpenCode will not run it (see isRetiredModel). */
  readonly isRetired: (model: string) => boolean
  /** The plugin's runtime/model fallback switched a session to this model. */
  readonly wasFallbackSwitch: (model: string) => boolean
}

export type LiveAgentModel = {
  /** Returns the model the message was moved to, or undefined when it was left alone. */
  readonly apply: (input: ChatMessageInput, output: ChatMessageHandlerOutput) => string | undefined
}

function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs
  } catch {
    return undefined
  }
}

export function defaultLiveAgentModelDeps(directory: string | undefined): LiveAgentModelDeps {
  return {
    userConfigPath: resolveConfigPath("user", directory ?? process.cwd(), undefined),
    ...(directory ? { projectConfigPath: resolveConfigPath("project", directory, undefined) } : {}),
    modifiedAt,
    read: readOpenCodeSection,
    loadedModel: getLoadedAgentModel,
    isBroken: (model) => isModelBroken(model),
    isRetired: (model) => isRetiredModel(model, catalog()),
    wasFallbackSwitch,
  }
}

let cachedCatalog: ModelCatalog | undefined
/** models.json is large and deprecations do not change within a session: load it once, on first need. */
function catalog(): ModelCatalog {
  cachedCatalog ??= loadModelCatalog()
  return cachedCatalog
}

function safeRead(deps: LiveAgentModelDeps, path: string): OpenCodeSection | undefined {
  try {
    return deps.read(path)
  } catch (error) {
    log("[live-agent-model] cannot read config", { path, error: String(error) })
    return undefined
  }
}

function sameModel(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false
  const a = parseModelString(left)
  const b = parseModelString(right)
  return a !== undefined && b !== undefined && a.providerID === b.providerID && a.modelID === b.modelID
}

function entryModel(entry: ModelChainEntry): string {
  return typeof entry === "string" ? entry : entry.model
}

function entryVariant(entry: ModelChainEntry): string | undefined {
  if (typeof entry === "string") return parseModelString(entry)?.variant
  const variant = entry["variant"]
  return typeof variant === "string" ? variant : parseModelString(entry.model)?.variant
}

function remember(history: Map<string, string[]>, agent: string, model: string | undefined): void {
  if (!model) return
  const seen = history.get(agent) ?? []
  if (!seen.some((entry) => sameModel(entry, model))) history.set(agent, [...seen, model])
}

export function createLiveAgentModel(deps: LiveAgentModelDeps): LiveAgentModel {
  const startupModifiedAt = deps.modifiedAt(deps.userConfigPath)
  const startupSection = startupModifiedAt === undefined ? undefined : safeRead(deps, deps.userConfigPath)
  const projectSection = deps.projectConfigPath && deps.modifiedAt(deps.projectConfigPath) !== undefined
    ? safeRead(deps, deps.projectConfigPath)
    : undefined
  let cached: { at: number; section: OpenCodeSection } | undefined
  /** Every omo.jsonc primary seen per agent (startup included): the TUI may still be pinned to any of them. */
  const primaries = new Map<string, string[]>()
  /** When an agent's startup model is retired, the model the TUI sent instead the first time (its recent[0]). */
  const standIns = new Map<string, string>()
  const standInChecked = new Set<string>()

  const currentSection = (): OpenCodeSection | undefined => {
    const at = deps.modifiedAt(deps.userConfigPath)
    if (at === undefined || at === startupModifiedAt) return undefined
    if (cached?.at !== at) {
      const section = safeRead(deps, deps.userConfigPath)
      if (!section) return undefined
      cached = { at, section }
    }
    return cached.section
  }

  const isDeliberatePick = (agent: string, messageModel: string, loaded: string | undefined): boolean => {
    if (sameModel(messageModel, loaded)) return false
    if ((primaries.get(agent) ?? []).some((model) => sameModel(model, messageModel))) return false
    if (deps.wasFallbackSwitch(messageModel)) return false
    return !sameModel(standIns.get(agent), messageModel)
  }

  return {
    apply: (input, output) => {
      if (!input.agent || !input.model) return undefined
      const agent = getAgentConfigKey(input.agent)
      const loaded = deps.loadedModel(agent)
      const messageModel = `${input.model.providerID}/${input.model.modelID}`
      const startupChain = readAgentChain(startupSection?.agents[agent])
      const startupPrimary = startupChain[0] === undefined ? loaded : entryModel(startupChain[0])
      remember(primaries, agent, startupPrimary)
      if (!standInChecked.has(agent)) {
        // The TUI validates the model the server registered for the agent; when it is retired it sends recent[0].
        standInChecked.add(agent)
        const configured = loaded ?? startupPrimary
        if (configured && !sameModel(messageModel, configured) && deps.isRetired(configured)) standIns.set(agent, messageModel)
      }

      const section = currentSection()
      if (!section) return undefined
      if (projectSection && readAgentChain(projectSection.agents[agent]).length > 0) return undefined
      const chain = readAgentChain(section.agents[agent])
      if (chain.length === 0 || JSON.stringify(chain) === JSON.stringify(startupChain)) return undefined

      const deliberate = isDeliberatePick(agent, messageModel, loaded)
      const primary = chain.find((entry) => !deps.isBroken(entryModel(entry)) && !deps.isRetired(entryModel(entry)))
      // Once omo.jsonc changes again, a TUI still pinned to this version's primary is not a deliberate pick.
      remember(primaries, agent, chain[0] === undefined ? undefined : entryModel(chain[0]))
      remember(primaries, agent, primary === undefined ? undefined : entryModel(primary))
      if (deliberate || !primary || sameModel(entryModel(primary), messageModel)) return undefined
      const parsed = parseModelString(entryModel(primary))
      if (!parsed) return undefined

      const variant = entryVariant(primary)
      // OpenCode keeps the variant inside the message model (UserMessage.model.variant), not at the top level.
      output.message.model = { providerID: parsed.providerID, modelID: parsed.modelID, ...(variant ? { variant } : {}) }
      const applied = `${parsed.providerID}/${parsed.modelID}`
      log("[live-agent-model] /omo-models change applied without restart", { agent, from: messageModel, to: applied })
      return applied
    },
  }
}
