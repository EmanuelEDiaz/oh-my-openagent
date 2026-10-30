import { brokenModelKey } from "./broken-models-cache"

/**
 * Models the plugin's own fallback (runtime fallback or model fallback) switched a session to. The live /omo-models
 * switch treats a message carrying one of them as "not a deliberate user pick": the user never chose it, the fallback
 * did, so a newly saved chain may replace it.
 */
const switched = new Set<string>()

export function recordFallbackSwitch(model: string): void {
  const key = brokenModelKey(model)
  if (key) switched.add(key)
}

export function wasFallbackSwitch(model: string): boolean {
  const key = brokenModelKey(model)
  return key !== undefined && switched.has(key)
}

export function clearFallbackSwitches(): void {
  switched.clear()
}
