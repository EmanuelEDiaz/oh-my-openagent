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
