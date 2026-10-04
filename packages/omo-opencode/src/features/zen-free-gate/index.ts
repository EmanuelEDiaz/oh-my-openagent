/**
 * Zen free-tier compatibility (04-10-2026). OpenCode Zen's free tier rejects any request whose tool list lacks both
 * `bash` and `read` ("free tier can only be used from within OpenCode"; undocumented, see anomalyco/opencode #51241,
 * #50627, #51315). Agents that hide them on purpose would not work on free Zen models, so for those agents only, and
 * only when their model is a free Zen model, the two tools stay visible while every use is still denied by permission:
 * OpenCode hides a tool only when its last rule denies "*", so an extra rule that never matches keeps it listed.
 */
const GATE_PATTERN = "__omo_zen_free_tier_compat_never_matches__"
const REQUIRED = ["bash", "read"] as const

const gated = new Set<string>()

export function isZenFreeModel(model: string | undefined): boolean {
  return !!model && /^opencode\/(?:[\w.-]+-free|big-pickle)$/.test(model)
}

type Rule = string | Record<string, string>

function wildcard(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
  return regex.test(value)
}

/** Whether OpenCode would hide `tool` for this permission object (last matching rule denies "*"). */
export function hidesTool(permission: Record<string, unknown> | undefined, tool: string): boolean {
  if (!permission) return false
  let last: Rule | undefined
  for (const [key, value] of Object.entries(permission)) {
    if (wildcard(key, tool) && (typeof value === "string" || (typeof value === "object" && value !== null))) last = value as Rule
  }
  if (last === undefined) return false
  if (typeof last === "string") return last === "deny"
  const entries = Object.entries(last)
  const final = entries[entries.length - 1]
  return !!final && final[0] === "*" && final[1] === "deny"
}

/** Keeps bash/read listed for Zen's gate while denying every real use. Returns the tools it re-listed. */
export function applyZenFreeGate(agentKey: string, agent: { permission?: Record<string, unknown>; prompt?: string; model?: string }): string[] {
  if (!isZenFreeModel(agent.model)) return []
  const relisted = REQUIRED.filter((tool) => hidesTool(agent.permission, tool))
  if (relisted.length === 0) return []
  agent.permission = { ...(agent.permission ?? {}), ...Object.fromEntries(relisted.map((tool) => [tool, { "*": "deny", [GATE_PATTERN]: "allow" }])) }
  agent.prompt = `${agent.prompt ?? ""}\n\nNote: the ${relisted.join(" and ")} tool${relisted.length > 1 ? "s are" : " is"} listed only for provider compatibility. ${relisted.length > 1 ? "They are" : "It is"} disabled for you: never call ${relisted.length > 1 ? "them" : "it"}.`
  gated.add(agentKey)
  return relisted
}

export function isZenGated(agentKey: string): boolean {
  return gated.has(agentKey)
}
