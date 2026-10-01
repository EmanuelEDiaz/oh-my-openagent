import type { AgentConfig } from "@opencode-ai/sdk"
import { isKnownMissingModel } from "@oh-my-opencode/model-core"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { log } from "../../shared/logger"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getConnectedFallbackModel, settleConfiguredModel, userFallbackModelIds } from "./model-resolution"
import { recordAgentRegistrationIssue } from "../../shared/agent-registration-report"
import { createAtlasAgent } from "../atlas"

export function maybeCreateAtlasConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem?: boolean
  connectedProviders?: readonly string[]
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories,
  } = input

  if (disabledAgents.includes("atlas")) return undefined

  const orchestratorOverride = agentOverrides["atlas"]
  const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

  let atlasResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model !== undefined ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    userFallbackModels: userFallbackModelIds(orchestratorOverride?.fallback_models),
    requirement: atlasRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!atlasResolution && orchestratorOverride?.model && !isKnownMissingModel(orchestratorOverride.model, availableModels)) {
    // User explicitly configured a model but resolution failed (e.g., cold cache, no system default).
    // Honor the user's choice directly instead of dropping Atlas entirely.
    atlasResolution = { model: orchestratorOverride.model, provenance: "override" as const }
  }

  if (!atlasResolution) {
    atlasResolution = getConnectedFallbackModel(atlasRequirement, input.connectedProviders ?? [], availableModels)
  }

  if (!atlasResolution) {
    // Never drop the orchestrator: register it without a model so OpenCode runs it on the session model.
    log("[agent-registration] Agent degraded: no model resolved, using the session model", { agent: "atlas" })
    recordAgentRegistrationIssue({
      agent: "atlas",
      status: "degraded",
      detail: "no configured or connected model; runs on the session model (set agents.atlas.model or use /omo-models)",
    })
  }
  const atlasModel = atlasResolution?.model
  const atlasResolvedVariant = atlasResolution?.variant

  let orchestratorConfig = createAtlasAgent({
    model: atlasModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (atlasResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories, directory)
  orchestratorConfig = settleConfiguredModel({
    agent: "atlas",
    config: orchestratorConfig,
    resolution: atlasResolution,
    overrideModel: orchestratorOverride?.model,
    availableModels,
  })

  return orchestratorConfig
}
