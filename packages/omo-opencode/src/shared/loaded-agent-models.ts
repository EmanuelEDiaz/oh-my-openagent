import { getAgentConfigKey } from "./agent-display-names"

/**
 * The model each agent was registered with when OpenCode loaded the plugin config (fork plan real-use-incidents A1).
 * The live /omo-models switch compares the model of each message against it: only a message still on the startup
 * model is moved to a newly saved chain, so a manual `/models` choice or an active fallback is never overridden.
 */
const loaded = new Map<string, string>()

export function recordLoadedAgentModels(agents: Readonly<Record<string, unknown>>): void {
  loaded.clear()
  for (const [name, config] of Object.entries(agents)) {
    const model = config !== null && typeof config === "object" ? (config as { model?: unknown }).model : undefined
    if (typeof model === "string" && model.includes("/")) loaded.set(getAgentConfigKey(name), model)
  }
}

export function getLoadedAgentModel(agentConfigKey: string): string | undefined {
  return loaded.get(agentConfigKey)
}

export function clearLoadedAgentModels(): void {
  loaded.clear()
}
