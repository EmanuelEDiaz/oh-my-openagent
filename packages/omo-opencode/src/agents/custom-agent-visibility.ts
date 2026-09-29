import type { AvailableAgent } from "./dynamic-agent-prompt-builder"

const MAX_TRIGGER_CHARS = 200
/** OpenCode's own agents: `build` is hidden by the plugin and `plan` is replaced by Prometheus. */
const NATIVE_AGENT_NAMES = new Set(["build", "plan"])

type CustomAgentSummary = { name: string; description: string; mode?: unknown; hidden?: unknown; disabled?: unknown; disable?: unknown }

function isSummary(value: unknown): value is CustomAgentSummary {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record["name"] === "string" && typeof record["description"] === "string"
}

function clip(text: string): string {
  const single = text.replace(/\s+/g, " ").trim()
  return single.length <= MAX_TRIGGER_CHARS ? single : `${single.slice(0, MAX_TRIGGER_CHARS)}…`
}

/**
 * Custom agents the orchestrator may delegate to: subagents with a description that do not shadow a builtin, a native
 * OpenCode agent or a disabled agent. Primary, hidden and disabled agents cannot be delegated to, so they are left out.
 */
export function customAgentsForDelegation(
  summaries: unknown,
  builtinNames: ReadonlySet<string>,
  disabledAgents: readonly string[],
): AvailableAgent[] {
  if (!Array.isArray(summaries)) return []
  const reserved = new Set([...builtinNames, ...NATIVE_AGENT_NAMES, ...disabledAgents].map((name) => name.toLowerCase()))
  const seen = new Set<string>()
  const agents: AvailableAgent[] = []
  for (const summary of summaries) {
    if (!isSummary(summary)) continue
    const key = summary.name.toLowerCase()
    if (reserved.has(key) || seen.has(key)) continue
    if (summary.mode === "primary" || summary.hidden === true || summary.disabled === true || summary.disable === true) continue
    if (summary.description.trim().length === 0) continue
    seen.add(key)
    agents.push({
      name: summary.name,
      description: summary.description,
      metadata: {
        category: "specialist",
        cost: "CHEAP",
        triggers: [{ domain: summary.name, trigger: clip(summary.description) }],
        requirement: { level: "optional" },
      },
    })
  }
  return agents
}
