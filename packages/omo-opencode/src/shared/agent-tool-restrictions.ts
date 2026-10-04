import { SPECIALISTS } from "../agents/specialists/catalog"
import { isZenGated } from "../features/zen-free-gate"
import { getAgentConfigKey, stripInvisibleAgentCharacters } from "./agent-display-names"

/**
 * Agent tool restrictions for session.prompt calls.
 * OpenCode SDK's session.prompt `tools` parameter expects boolean values.
 * true = tool allowed, false = tool denied.
 */

const TEAM_TOOL_DENYLIST: Record<string, boolean> = {
  team_create: false,
  team_delete: false,
  team_shutdown_request: false,
  team_approve_shutdown: false,
  team_reject_shutdown: false,
  team_send_message: false,
  team_task_create: false,
  team_task_list: false,
  team_task_update: false,
  team_task_get: false,
  team_status: false,
  team_list: false,
}

const EXPLORATION_AGENT_DENYLIST: Record<string, boolean> = {
  write: false,
  edit: false,
  task: false,
  call_omo_agent: false,
}

const AGENT_RESTRICTIONS: Record<string, Record<string, boolean>> = {
  explore: EXPLORATION_AGENT_DENYLIST,

  librarian: EXPLORATION_AGENT_DENYLIST,

  oracle: {
    write: false,
    edit: false,
    task: false,
    call_omo_agent: false,
  },

  metis: {
    write: false,
    edit: false,
  },

  momus: {
    write: false,
    edit: false,
  },

  "multimodal-looker": {
    read: true,
  },

  "sisyphus-junior": {
    task: false,
  },
}

type AgentToolRestrictionsOptions = {
  includeTeamToolDenylist?: boolean
}

export function getAgentToolRestrictions(agentName: string, options: AgentToolRestrictionsOptions = {}): Record<string, boolean> {
  const stripped = stripInvisibleAgentCharacters(agentName)
  const agentRestrictions = AGENT_RESTRICTIONS[stripped]
    ?? Object.entries(AGENT_RESTRICTIONS).find(([key]) => key.toLowerCase() === stripped.toLowerCase())?.[1]
    ?? {}

  return {
    ...(options.includeTeamToolDenylist === false ? {} : TEAM_TOOL_DENYLIST),
    ...agentRestrictions,
    ...specialistRestrictions(stripped),
  }
}

/**
 * Specialists are atomic and never delegate (only tab agents orchestrate). The per-prompt tool map is applied after the
 * agent's own permissions, so it must repeat the denial or `call_omo_agent: true` would win. A specialist with
 * `onlyTools` (web-researcher) sees nothing else: "*" first, then its own tools (OpenCode applies the last match).
 */
function specialistRestrictions(agentName: string): Record<string, boolean> {
  const key = getAgentConfigKey(agentName)
  const spec = SPECIALISTS.find((candidate) => candidate.name === key || candidate.name === agentName.toLowerCase())
  if (!spec) return {}
  // A Zen-gated agent keeps bash/read listed (denied by its permission): a per-prompt "*": false would hide them again.
  return {
    ...(spec.onlyTools && !isZenGated(spec.name) ? { "*": false } : {}),
    task: false,
    call_omo_agent: false,
    ...Object.fromEntries((spec.onlyTools ?? []).map((tool) => [tool, true])),
  }
}

