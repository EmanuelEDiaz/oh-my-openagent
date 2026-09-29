import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { log } from "../../shared/logger"
import { createHephaestusAgent, isHephaestusSupportedModel } from "../hephaestus"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getConnectedFallbackModel, getFirstFallbackModel, keepFallbackOverRetiredModel, userFallbackModelIds } from "./model-resolution"
import { recordAgentRegistrationIssue } from "../../shared/agent-registration-report"

const HEPHAESTUS_SKIP_HINT = "Hephaestus needs a GPT model: set agents.hephaestus.model (or connect an OpenAI-compatible provider)"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"

export function maybeCreateHephaestusConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  useTaskSystem: boolean
  disableOmoEnv?: boolean
  connectedProviders?: readonly string[]
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
  } = input

  if (disabledAgents.includes("hephaestus")) return undefined

  const hephaestusOverride = agentOverrides["hephaestus"]
  const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
  const hasHephaestusExplicitConfig = hephaestusOverride !== undefined

  const hasRequiredProvider =
    !hephaestusRequirement?.requiresProvider ||
    hasHephaestusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(hephaestusRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) {
    log("[agent-registration] Agent skipped: required provider not connected", {
      agent: "hephaestus",
      requiredProvider: hephaestusRequirement?.requiresProvider,
    })
    recordAgentRegistrationIssue({ agent: "hephaestus", status: "skipped", detail: HEPHAESTUS_SKIP_HINT })
    return undefined
  }

  let hephaestusResolution = applyModelResolution({
    userModel: hephaestusOverride?.model,
    userFallbackModels: userFallbackModelIds(hephaestusOverride?.fallback_models),
    requirement: hephaestusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !hephaestusOverride?.model) {
    // Hephaestus is GPT-only, so it cannot fall back to the session model. Before the provider cache exists nothing can
    // be verified: keep the upstream GPT guess, but tell the user (fork roadmap 0.3).
    hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
    if (hephaestusResolution) {
      recordAgentRegistrationIssue({
        agent: "hephaestus",
        status: "degraded",
        detail: `first run: ${hephaestusResolution.model} is assumed, not verified — set agents.hephaestus.model or use /omo-models`,
      })
    }
  } else if (!hephaestusResolution) {
    // With a provider cache, only a GPT model the user can actually reach; otherwise a visible skip.
    hephaestusResolution = getConnectedFallbackModel(hephaestusRequirement, input.connectedProviders ?? [], availableModels)
  }

  if (!hephaestusResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "hephaestus",
      configuredModel: hephaestusOverride?.model,
    })
    recordAgentRegistrationIssue({ agent: "hephaestus", status: "skipped", detail: HEPHAESTUS_SKIP_HINT })
    return undefined
  }
  const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

  if (!isHephaestusSupportedModel(hephaestusModel)) {
    log("[agent-registration] Agent skipped: unsupported Hephaestus model", {
      agent: "hephaestus",
      configuredModel: hephaestusModel,
    })
    recordAgentRegistrationIssue({ agent: "hephaestus", status: "skipped", detail: `${HEPHAESTUS_SKIP_HINT} (resolved ${hephaestusModel})` })
    return undefined
  }

  let hephaestusConfig = createHephaestusAgent(
    hephaestusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  hephaestusConfig = { ...hephaestusConfig, variant: hephaestusResolvedVariant ?? "medium" }

  const hepOverrideCategory = (hephaestusOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (hepOverrideCategory) {
    hephaestusConfig = applyCategoryOverride(hephaestusConfig, hepOverrideCategory, mergedCategories)
    if (!isHephaestusSupportedModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus category model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  hephaestusConfig = applyEnvironmentContext(hephaestusConfig, directory, { disableOmoEnv })

  if (hephaestusOverride) {
    hephaestusConfig = mergeAgentConfig(hephaestusConfig, hephaestusOverride, directory)
    hephaestusConfig = keepFallbackOverRetiredModel(hephaestusConfig, hephaestusResolution, hephaestusOverride.model)
    if (!isHephaestusSupportedModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus override model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  const resolvedModel = hephaestusConfig.model ?? ""
  hephaestusConfig.permission = applyFrontierToolSchemaPermission(
    hephaestusConfig.permission,
    resolvedModel,
    hephaestusOverride?.permission,
    (hephaestusOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  return hephaestusConfig
}
