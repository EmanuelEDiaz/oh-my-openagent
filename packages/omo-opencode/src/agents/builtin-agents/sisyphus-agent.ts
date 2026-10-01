import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { log } from "../../shared/logger"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getConnectedFallbackModel, promptModelHint, settleConfiguredModel, userFallbackModelIds } from "./model-resolution"
import { recordAgentRegistrationIssue } from "../../shared/agent-registration-report"
import { createSisyphusAgent } from "../sisyphus"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"
import { setSisyphusRuntimePromptContext } from "../sisyphus-runtime-prompt-reconciler"

export function maybeCreateSisyphusConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem: boolean
  disableOmoEnv?: boolean
  connectedProviders?: readonly string[]
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
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

  const sisyphusOverride = agentOverrides["sisyphus"]
  const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
  const hasSisyphusExplicitConfig = sisyphusOverride !== undefined
  const meetsSisyphusAnyModelRequirement =
    !sisyphusRequirement?.requiresAnyModel ||
    hasSisyphusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

  if (disabledAgents.includes("sisyphus")) return undefined

  let sisyphusResolution = !meetsSisyphusAnyModelRequirement ? undefined : applyModelResolution({
    uiSelectedModel: sisyphusOverride?.model !== undefined ? undefined : uiSelectedModel,
    userModel: sisyphusOverride?.model,
    userFallbackModels: userFallbackModelIds(sisyphusOverride?.fallback_models),
    requirement: sisyphusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!sisyphusResolution) {
    sisyphusResolution = getConnectedFallbackModel(sisyphusRequirement, input.connectedProviders ?? [], availableModels)
  }

  if (!sisyphusResolution) {
    // The main orchestrator is never dropped: it runs on the session model and the user is told why.
    log("[agent-registration] Agent degraded: no model resolved, using the session model", { agent: "sisyphus" })
    recordAgentRegistrationIssue({
      agent: "sisyphus",
      status: "degraded",
      detail: "no configured or connected model; runs on the session model (set agents.sisyphus.model or use /omo-models)",
    })
  }
  // A degraded Sisyphus still needs a model id to pick its prompt; the runtime reconciler rebuilds it for the real one.
  const sisyphusModel = sisyphusResolution?.model ?? promptModelHint(sisyphusRequirement)
  const sisyphusResolvedVariant = sisyphusResolution?.variant

  let sisyphusConfig = createSisyphusAgent(
    sisyphusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  if (sisyphusResolvedVariant) {
    sisyphusConfig = { ...sisyphusConfig, variant: sisyphusResolvedVariant }
  }

  sisyphusConfig = applyOverrides(sisyphusConfig, sisyphusOverride, mergedCategories, directory)
  sisyphusConfig = settleConfiguredModel({
    agent: "sisyphus",
    config: sisyphusConfig,
    resolution: sisyphusResolution,
    overrideModel: sisyphusOverride?.model,
    availableModels,
  })
  if (!sisyphusResolution && sisyphusOverride?.model === undefined) {
    const { model: _promptOnlyModel, ...withoutModel } = sisyphusConfig
    sisyphusConfig = withoutModel
  }

  const resolvedModel = sisyphusConfig.model ?? ""
  sisyphusConfig.permission = applyFrontierToolSchemaPermission(
    sisyphusConfig.permission,
    resolvedModel,
    sisyphusOverride?.permission,
    (sisyphusOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  sisyphusConfig = applyEnvironmentContext(sisyphusConfig, directory, {
    disableOmoEnv,
  })

  // The body above is baked from the *configured* model. If the user switches to
  // a different model in the TUI, the system-transform hook rebuilds the
  // prompt for the runtime model using this captured pipeline (issue #5297/#5316/#6966).
  setSisyphusRuntimePromptContext({
    configuredModel: sisyphusModel,
    bakedPrompt: sisyphusConfig.prompt ?? "",
    rebuildPromptForModel: (runtimeModel: string): string => {
      let rebuilt = createSisyphusAgent(
        runtimeModel,
        availableAgents,
        undefined,
        availableSkills,
        availableCategories,
        useTaskSystem
      )
      rebuilt = applyOverrides(rebuilt, sisyphusOverride, mergedCategories, directory)
      rebuilt = applyEnvironmentContext(rebuilt, directory, { disableOmoEnv })
      return rebuilt.prompt ?? ""
    },
  })

  return sisyphusConfig
}
