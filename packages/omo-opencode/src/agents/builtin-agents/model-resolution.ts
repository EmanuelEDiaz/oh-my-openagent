import { normalizeFallbackModels, resolveModelPipeline } from "../../shared"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"

/** Plain `provider/model` ids of the user's configured fallbacks (per-entry settings are applied later). */
export function userFallbackModelIds(fallbackModels: Parameters<typeof normalizeFallbackModels>[0]): string[] | undefined {
  return normalizeFallbackModels(fallbackModels)?.map((entry) => (typeof entry === "string" ? entry : entry.model))
}

export function applyModelResolution(input: {
  uiSelectedModel?: string
  userModel?: string
  userFallbackModels?: string[]
  requirement?: { fallbackChain?: { providers: string[]; model: string; variant?: string }[] }
  availableModels: Set<string>
  systemDefaultModel?: string
}) {
  const { uiSelectedModel, userModel, userFallbackModels, requirement, availableModels, systemDefaultModel } = input
  return resolveModelPipeline({
    intent: { uiSelectedModel, userModel, userFallbackModels },
    constraints: { availableModels },
    policy: { fallbackChain: requirement?.fallbackChain, systemDefaultModel },
  })
}

export function getFirstFallbackModel(requirement?: {
  fallbackChain?: { providers: string[]; model: string; variant?: string }[]
}) {
  const entry = requirement?.fallbackChain?.[0]
  if (!entry || entry.providers.length === 0) return undefined
  const provider = entry.providers[0]
  const transformedModel = transformModelForProvider(provider, entry.model)
  return {
    model: `${provider}/${transformedModel}`,
    provenance: "provider-fallback" as const,
    variant: entry.variant,
  }
}

/**
 * Last resort after the pipeline: the first chain entry served by a provider the user actually connected. Unlike
 * getFirstFallbackModel it never picks a provider the user has no credentials for; with no provider cache yet it
 * returns nothing, and the caller registers the agent without a model instead (fork roadmap 0.3).
 */
export function getConnectedFallbackModel(
  requirement: { fallbackChain?: { providers: string[]; model: string; variant?: string }[] } | undefined,
  connectedProviders: readonly string[],
  availableModels: ReadonlySet<string> = new Set(),
) {
  if (connectedProviders.length === 0) return undefined
  for (const entry of requirement?.fallbackChain ?? []) {
    for (const provider of entry.providers.filter((candidate) => connectedProviders.includes(candidate))) {
      const model = `${provider}/${transformModelForProvider(provider, entry.model)}`
      // When the model list is known, a connected provider is not enough: the model must be listed (a free-tier
      // account lists no paid models). With no list yet, trust the connected provider.
      if (availableModels.size > 0 && !availableModels.has(model)) continue
      return {
        model,
        provenance: "provider-fallback" as const,
        variant: entry.variant,
      }
    }
  }
  return undefined
}

/** Model id used only to pick a prompt variant for an agent registered without a model. */
export function promptModelHint(requirement?: { fallbackChain?: { providers: string[]; model: string }[] }): string {
  return getFirstFallbackModel(requirement)?.model ?? ""
}

/**
 * Agent overrides are merged after resolution and would copy the configured `model` back on top.
 * When resolution skipped that model because its provider no longer lists it, keep the fallback.
 */
export function keepFallbackOverRetiredModel<TConfig extends { model?: string }>(
  config: TConfig,
  resolution: { model: string; attempted?: string[] },
  overrideModel: string | undefined,
): TConfig {
  if (overrideModel === undefined || resolution.model === overrideModel) return config
  if (!resolution.attempted?.includes(overrideModel)) return config
  return { ...config, model: resolution.model }
}
