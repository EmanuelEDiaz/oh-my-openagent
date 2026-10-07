import { statSync } from "node:fs"

import { readAgentChain } from "../../cli/config-models/agent-chains"
import type { ModelChainEntry } from "../../cli/config-models/agent-chains"
import { readOpenCodeSection, resolveConfigPath } from "../../cli/config-models/context"
import type { OpenCodeSection } from "../../cli/config-models/context"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { isModelBroken } from "../../shared/broken-models-cache"
import { getLoadedAgentModel } from "../../shared/loaded-agent-models"
import { log } from "../../shared/logger"
import { parseModelString } from "../../shared/model-string-parser"
import type { ChatMessageHandlerOutput, ChatMessageInput } from "./types"

/**
 * /omo-models applies without restarting OpenCode (fork plan real-use-incidents A1). OpenCode resolves agent models
 * once, when it loads the plugin config, and the TUI then sends that model with every prompt. On each user message
 * this checks whether ~/.omo/omo.jsonc changed since startup; if the agent's chain changed, the message is moved to
 * the new primary, but only while the message still carries the startup model: a manual `/models` choice, an active
 * fallback or a project-level chain (which wins over the user file) are left alone.
 */
export type LiveAgentModelDeps = {
  readonly userConfigPath: string
  readonly projectConfigPath?: string
  readonly modifiedAt: (path: string) => number | undefined
  readonly read: (path: string) => OpenCodeSection
  readonly loadedModel: (agentConfigKey: string) => string | undefined
  readonly isBroken: (model: string) => boolean
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
  }
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

export function createLiveAgentModel(deps: LiveAgentModelDeps): LiveAgentModel {
  const startupModifiedAt = deps.modifiedAt(deps.userConfigPath)
  const startupSection = startupModifiedAt === undefined ? undefined : safeRead(deps, deps.userConfigPath)
  const projectSection = deps.projectConfigPath && deps.modifiedAt(deps.projectConfigPath) !== undefined
    ? safeRead(deps, deps.projectConfigPath)
    : undefined
  let cached: { at: number; section: OpenCodeSection } | undefined

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

  return {
    apply: (input, output) => {
      if (!input.agent || !input.model) return undefined
      const section = currentSection()
      if (!section) return undefined

      const agent = getAgentConfigKey(input.agent)
      if (projectSection && readAgentChain(projectSection.agents[agent]).length > 0) return undefined
      const chain = readAgentChain(section.agents[agent])
      const startupChain = readAgentChain(startupSection?.agents[agent])
      if (chain.length === 0 || JSON.stringify(chain) === JSON.stringify(startupChain)) return undefined

      const loaded = deps.loadedModel(agent)
      const messageModel = `${input.model.providerID}/${input.model.modelID}`
      if (!sameModel(messageModel, loaded)) return undefined

      const primary = chain.find((entry) => !deps.isBroken(entryModel(entry)))
      if (!primary || sameModel(entryModel(primary), loaded)) return undefined
      const parsed = parseModelString(entryModel(primary))
      if (!parsed) return undefined

      output.message.model = { providerID: parsed.providerID, modelID: parsed.modelID }
      const variant = entryVariant(primary)
      if (variant) output.message["variant"] = variant
      const applied = `${parsed.providerID}/${parsed.modelID}`
      log("[live-agent-model] /omo-models change applied without restart", { agent, from: loaded, to: applied })
      return applied
    },
  }
}
