import type { AgentConfig } from "@opencode-ai/sdk"
import { isKnownMissingModel } from "@oh-my-opencode/model-core"
import type { BuiltinAgentName, AgentOverrides, AgentPromptMetadata } from "../types"
import type { CategoryConfig, GitMasterConfig } from "../../config/schema"
import type { BrowserAutomationProvider } from "../../config/schema"
import type { AvailableAgent } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isModelAvailable } from "../../shared"
import { buildAgent, isFactory } from "../agent-builder"
import { resolveAgentSkills } from "../agent-skill-resolution"
import { applyOverrides } from "./agent-overrides"
import { applyEnvironmentContext } from "./environment-context"
import { applyModelResolution, getConnectedFallbackModel, promptModelHint, settleConfiguredModel, userFallbackModelIds } from "./model-resolution"
import { recordAgentRegistrationIssue } from "../../shared/agent-registration-report"
import { log } from "../../shared/logger"

export function collectPendingBuiltinAgents(input: {
  agentSources: Record<BuiltinAgentName, import("../agent-builder").AgentSource>
  agentMetadata: Partial<Record<BuiltinAgentName, AgentPromptMetadata>>
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  directory?: string
  systemDefaultModel?: string
  mergedCategories: Record<string, CategoryConfig>
  gitMasterConfig?: GitMasterConfig
  browserProvider?: BrowserAutomationProvider
  uiSelectedModel?: string
  availableModels: Set<string>
  isFirstRunNoCache: boolean
  disabledSkills?: Set<string>
  teamModeEnabled?: boolean
  useTaskSystem?: boolean
  disableOmoEnv?: boolean
  connectedProviders?: readonly string[]
}): { pendingAgentConfigs: Map<string, AgentConfig>; availableAgents: AvailableAgent[] } {
  const {
    agentSources,
    agentMetadata,
    disabledAgents,
    agentOverrides,
    directory,
    systemDefaultModel,
    mergedCategories,
    gitMasterConfig,
    browserProvider,
    uiSelectedModel,
    availableModels,
    isFirstRunNoCache: _isFirstRunNoCache,
    disabledSkills,
    teamModeEnabled,
    disableOmoEnv = false,
  } = input

  const availableAgents: AvailableAgent[] = []
  const pendingAgentConfigs: Map<string, AgentConfig> = new Map()

  for (const [name, source] of Object.entries(agentSources)) {
    const agentName = name as BuiltinAgentName

    if (agentName === "sisyphus") continue
    if (agentName === "hephaestus") continue
    if (agentName === "atlas") continue
    if (agentName === "sisyphus-junior") continue
    if (disabledAgents.some((name) => name.toLowerCase() === agentName.toLowerCase())) continue

    const override = agentOverrides[agentName]
      ?? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentName.toLowerCase())?.[1]
    const requirement = AGENT_MODEL_REQUIREMENTS[agentName]

    // Check if agent requires a specific model
    if (requirement?.requiresModel && availableModels) {
      if (!isModelAvailable(requirement.requiresModel, availableModels)) {
        log("[agent-registration] Agent skipped: required model not available", {
          agent: agentName,
          requiredModel: requirement.requiresModel,
        })
        continue
      }
    }

    const isPrimaryAgent = isFactory(source) && source.mode === "primary"

    let resolution = applyModelResolution({
      uiSelectedModel: (isPrimaryAgent && override?.model === undefined) ? uiSelectedModel : undefined,
      userModel: override?.model,
      userFallbackModels: userFallbackModelIds(override?.fallback_models),
      requirement,
      availableModels,
      systemDefaultModel,
    })
    if (!resolution) {
      if (override?.model && !isKnownMissingModel(override.model, availableModels)) {
        // User explicitly configured a model but resolution failed (e.g., cold cache).
        // Honor the user's choice directly instead of falling back to hardcoded chain.
        log("[agent-registration] User-configured model not resolved, using as-is", {
          agent: agentName,
          configuredModel: override.model,
        })
        resolution = { model: override.model, provenance: "override" as const }
      } else {
        resolution = getConnectedFallbackModel(requirement, input.connectedProviders ?? [], availableModels)
      }
    }
    if (!resolution) {
      // Registered without a model: OpenCode runs it on the caller's/session model instead of a provider the user
      // never connected (fork roadmap 0.3).
      log("[agent-registration] Agent degraded: no model resolved, using the session model", { agent: agentName })
      recordAgentRegistrationIssue({
        agent: agentName,
        status: "degraded",
        detail: `no configured or connected model; runs on the session model (set agents.${agentName}.model or use /omo-models)`,
      })
    }
    const model = resolution?.model ?? promptModelHint(requirement)
    const resolvedVariant = resolution?.variant

    let config = buildAgent(source, model, mergedCategories)
    if (!resolution) {
      const { model: _promptOnlyModel, ...withoutModel } = config
      config = withoutModel
    }

    // Apply resolved variant from model fallback chain
    if (resolvedVariant) {
      config = { ...config, variant: resolvedVariant }
    }

    if (agentName === "librarian") {
      config = applyEnvironmentContext(config, directory, { disableOmoEnv })
    }

    config = applyOverrides(config, override, mergedCategories, directory)
    config = settleConfiguredModel({ agent: agentName, config, resolution, overrideModel: override?.model, availableModels })
    config = resolveAgentSkills(config, { gitMasterConfig, browserProvider, disabledSkills, teamModeEnabled })

    // Store for later - will be added after sisyphus and hephaestus
    pendingAgentConfigs.set(name, config)

    const metadata = agentMetadata[agentName]
    if (metadata) {
      availableAgents.push({
        name: agentName,
        description: config.description ?? "",
        metadata,
      })
    }
  }

  return { pendingAgentConfigs, availableAgents }
}
