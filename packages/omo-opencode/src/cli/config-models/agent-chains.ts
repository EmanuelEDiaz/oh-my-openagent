import { BuiltinAgentNameSchema } from "../../config/schema/agent-names"

export type ModelChainEntry = string | ({ readonly model: string } & Readonly<Record<string, unknown>>)

export type AgentChain = {
  readonly agent: string
  readonly entries: readonly ModelChainEntry[]
}

export type ChainAvailability = {
  readonly agent: string
  readonly models: readonly string[]
  readonly missing: readonly string[]
  readonly firstAvailable: string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function toEntry(value: unknown): ModelChainEntry | undefined {
  if (typeof value === "string" && value.length > 0) return value
  if (isRecord(value) && typeof value["model"] === "string") return value as ModelChainEntry
  return undefined
}

function toEntries(value: unknown): ModelChainEntry[] {
  const values = Array.isArray(value) ? value : [value]
  return values.map(toEntry).filter((entry): entry is ModelChainEntry => entry !== undefined)
}

export function entryModel(entry: ModelChainEntry): string {
  return typeof entry === "string" ? entry : entry.model
}

/** Mirrors validate.ts materializeAgentModelChains: `models` wins over `model` + `fallback_models`. */
export function readAgentChain(agentConfig: unknown): ModelChainEntry[] {
  if (!isRecord(agentConfig)) return []
  if (agentConfig["models"] !== undefined) return toEntries(agentConfig["models"])
  return [...toEntries(agentConfig["model"]), ...toEntries(agentConfig["fallback_models"])]
}

/** Only oh-my-openagent's own agents; OpenCode's native build/plan agents are not managed here. */
export const CONFIGURABLE_AGENTS: readonly string[] = BuiltinAgentNameSchema.options

export function isConfigurableAgent(agent: string): boolean {
  return CONFIGURABLE_AGENTS.includes(agent)
}

export function readAgentChains(agents: Readonly<Record<string, unknown>>): AgentChain[] {
  return CONFIGURABLE_AGENTS.map((agent) => ({ agent, entries: readAgentChain(agents[agent]) }))
}

export function checkChainAvailability(chain: AgentChain, available: ReadonlySet<string>): ChainAvailability {
  const models = chain.entries.map(entryModel)
  return {
    agent: chain.agent,
    models,
    missing: models.filter((model) => !available.has(model)),
    firstAvailable: models.find((model) => available.has(model)),
  }
}

/** Keeps per-model settings (reasoning, temperature, ...) of models that were already in the chain. */
export function buildChainEntries(
  orderedModels: readonly string[],
  previous: readonly ModelChainEntry[],
): ModelChainEntry[] {
  const previousByModel = new Map(previous.map((entry) => [entryModel(entry), entry]))
  return orderedModels.map((model) => previousByModel.get(model) ?? model)
}
