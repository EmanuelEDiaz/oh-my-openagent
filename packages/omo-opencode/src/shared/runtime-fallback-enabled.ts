import type { OhMyOpenCodeConfig } from "../config"

/**
 * runtime_fallback is on unless the user turns it off (fork plan real-use-incidents A3). While it is on it is the only
 * active fallback path; model_fallback stays on standby (event-model-fallback.ts shouldHandleModelFallback).
 */
export function isRuntimeFallbackConfigEnabled(pluginConfig: Pick<OhMyOpenCodeConfig, "runtime_fallback">): boolean {
  const value = pluginConfig.runtime_fallback
  return typeof value === "boolean" ? value : (value?.enabled ?? true)
}
