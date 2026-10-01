import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "../../../shared/model-requirements"
import { getModelCapabilities } from "../../../shared/model-capabilities"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { loadOmoConfig } from "./model-resolution-config"
import { fetchAvailableModels } from "../../../shared/model-availability"
import { readConnectedProvidersCache } from "../../../shared/connected-providers-cache"
import { paidModelCheck, setPreferFreeModels } from "../../../shared/free-model-preference"
import { validatePluginConfig } from "../../../config/validate"
import { buildModelResolutionDetails } from "./model-resolution-details"
import { buildEffectiveResolution, getEffectiveModel } from "./model-resolution-effective-model"
import type { AgentResolutionInfo, CategoryResolutionInfo, ModelResolutionInfo, OmoConfig } from "./model-resolution-types"
import { resolveModelPipeline } from "../../../shared/model-resolution-pipeline"
import type { ModelRequirement } from "../../../shared/model-requirements"

import { SESSION_MODEL } from "./model-resolution-constants"

export { SESSION_MODEL }

/** What the running plugin knows when it picks models; with it the doctor mirrors the runtime choice (fork 0.6). */
export type RuntimeModelContext = {
  readonly availableModels: ReadonlySet<string>
  readonly connectedProviders: readonly string[] | null
  readonly isPaidModel?: (model: string) => boolean
}

function runtimeResolution(requirement: ModelRequirement, runtime: RuntimeModelContext): { model: string; resolution: string } {
  const resolved = resolveModelPipeline({
    constraints: { availableModels: new Set(runtime.availableModels), connectedProviders: runtime.connectedProviders ? [...runtime.connectedProviders] : null },
    policy: { fallbackChain: requirement.fallbackChain, ...(runtime.isPaidModel ? { isPaidModel: runtime.isPaidModel } : {}) },
  })
  if (!resolved) {
    return { model: SESSION_MODEL, resolution: "No configured or available model in its chain — runs on the session model" }
  }
  return { model: resolved.model, resolution: `Provider fallback (available): ${resolved.model}` }
}


export function parseProviderModel(value: string): { providerID: string; modelID: string } | null {
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return null
  }

  return {
    providerID: value.slice(0, slashIndex),
    modelID: value.slice(slashIndex + 1),
  }
}

function attachCapabilityDiagnostics<T extends AgentResolutionInfo | CategoryResolutionInfo>(entry: T): T {
  const parsed = parseProviderModel(entry.effectiveModel)
  if (!parsed) {
    return entry
  }

  return {
    ...entry,
    capabilityDiagnostics: getModelCapabilities({
      providerID: parsed.providerID,
      modelID: parsed.modelID,
    }).diagnostics,
  }
}

export function getModelResolutionInfo(): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) =>
    attachCapabilityDiagnostics({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    })
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) =>
      attachCapabilityDiagnostics({
        name,
        requirement,
        effectiveModel: getEffectiveModel(requirement),
        effectiveResolution: buildEffectiveResolution(requirement),
      })
  )

  return { agents, categories }
}

export function getModelResolutionInfoWithOverrides(config: OmoConfig, runtime?: RuntimeModelContext): ModelResolutionInfo {
  const effective = (requirement: ModelRequirement, userOverride: string | undefined) => {
    if (!runtime || userOverride) {
      return { effectiveModel: getEffectiveModel(requirement, userOverride), effectiveResolution: buildEffectiveResolution(requirement, userOverride) }
    }
    const { model, resolution } = runtimeResolution(requirement, runtime)
    return { effectiveModel: model, effectiveResolution: resolution }
  }
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => {
    const userOverride = config.agents?.[name]?.model
    const userVariant = config.agents?.[name]?.variant
    return attachCapabilityDiagnostics({
      name,
      requirement,
      userOverride,
      userVariant,
      ...effective(requirement, userOverride),
    })
  })

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const userOverride = config.categories?.[name]?.model
      const userVariant = config.categories?.[name]?.variant
      return attachCapabilityDiagnostics({
        name,
        requirement,
        userOverride,
        userVariant,
        ...effective(requirement, userOverride),
      })
    }
  )

  return { agents, categories }
}

export function collectCapabilityResolutionIssues(info: ModelResolutionInfo): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const allEntries = [...info.agents, ...info.categories]
  const fallbackEntries = allEntries.filter((entry) => {
    const mode = entry.capabilityDiagnostics?.resolutionMode
    return mode === "unknown"
  })

  if (fallbackEntries.length === 0) {
    return issues
  }

  const summary = fallbackEntries
    .map((entry) => `${entry.name}=${entry.effectiveModel} (${entry.capabilityDiagnostics?.resolutionMode ?? "unknown"})`)
    .join(", ")

  issues.push({
    title: "Configured models rely on compatibility fallback",
    description: summary,
    severity: "warning",
    affects: fallbackEntries.map((entry) => entry.name),
  })

  return issues
}

/** The same inputs the running plugin uses to pick models, so the doctor shows the real choice (fork 0.6). */
async function loadRuntimeModelContext(): Promise<RuntimeModelContext> {
  const connectedProviders = readConnectedProvidersCache()
  setPreferFreeModels(validatePluginConfig(process.cwd()).config.prefer_free_models === true)
  const availableModels = await fetchAvailableModels(undefined, { connectedProviders: connectedProviders ?? undefined })
  const isPaidModel = paidModelCheck()
  return { availableModels, connectedProviders, ...(isPaidModel ? { isPaidModel } : {}) }
}

export async function checkModels(
  loadRuntime: () => Promise<RuntimeModelContext> = loadRuntimeModelContext,
): Promise<CheckResult> {
  const config = loadOmoConfig() ?? {}
  const info = getModelResolutionInfoWithOverrides(config, await loadRuntime())
  const available = loadAvailableModelsFromCache()
  const issues: DoctorIssue[] = []

  if (!available.cacheExists) {
    issues.push({
      title: "Model cache not found",
      description: "OpenCode model cache is missing, so model availability cannot be validated.",
      fix: "Run: opencode models --refresh",
      severity: "warning",
      affects: ["model resolution"],
    })
  }

  issues.push(...collectCapabilityResolutionIssues(info))

  const overrideCount =
    info.agents.filter((agent) => Boolean(agent.userOverride)).length +
    info.categories.filter((category) => Boolean(category.userOverride)).length

  return {
    name: CHECK_NAMES[CHECK_IDS.MODELS],
    status: issues.length > 0 ? "warn" : "pass",
    message: `${info.agents.length} agents, ${info.categories.length} categories, ${overrideCount} override${overrideCount === 1 ? "" : "s"}`,
    details: buildModelResolutionDetails({ info, available, config }),
    issues,
  }
}

export const checkModelResolution = checkModels
