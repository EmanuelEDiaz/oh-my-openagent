import { getAgentConfigKey } from "../shared/agent-display-names"

/**
 * Fixed specialist sets per tab agent (fork roadmap 0.22, approved by the user 11-10-2026). Tab agents had too much
 * freedom: any of them could call any specialist. Each one now delegates only inside its role; a request outside it
 * is refused by code, with the tab agent the user should switch to. The user's own subagents (roadmap 2.2, D4) are
 * outside these sets and stay available to every orchestrator. `sisyphus-junior` stands for every `category` task.
 */
export const TAB_AGENT_SPECIALISTS: Readonly<Record<string, readonly string[]>> = {
  sisyphus: [
    "explore", "librarian", "api-lookup", "web-researcher", "memory", "debugger", "test-writer", "verifier",
    "dependency-check", "oracle", "sisyphus-junior",
  ],
  hephaestus: ["explore", "librarian", "api-lookup", "debugger", "test-writer", "verifier", "lang-reviewer", "sisyphus-junior"],
  prometheus: ["explore", "librarian", "web-researcher", "api-lookup", "memory", "metis", "momus", "oracle", "architect-reviewer"],
  atlas: [
    "explore", "sisyphus-junior", "test-writer", "debugger", "verifier", "ui-tester", "security-reviewer", "test-reviewer",
    "lang-reviewer", "architect-reviewer", "docs-writer", "git-committer",
  ],
}

const TAB_AGENT_LABELS: Readonly<Record<string, string>> = {
  sisyphus: "Sisyphus",
  hephaestus: "Hephaestus",
  prometheus: "Prometheus",
  atlas: "Atlas",
}

/** Every specialist that belongs to some tab agent's set: the plugin's roster. */
const ROSTER = new Set(Object.values(TAB_AGENT_SPECIALISTS).flat())

export function isTabAgent(agent: string | undefined): boolean {
  return agent !== undefined && getAgentConfigKey(agent) in TAB_AGENT_SPECIALISTS
}

/** Whether a tab agent may list (and call) this specialist; agents outside the roster are the user's own and allowed. */
export function isAllowedForTabAgent(tabAgent: string, target: string): boolean {
  const allowed = TAB_AGENT_SPECIALISTS[getAgentConfigKey(tabAgent)]
  const key = getAgentConfigKey(target)
  return allowed === undefined || !ROSTER.has(key) || allowed.includes(key)
}

/**
 * Undefined when the delegation is allowed; otherwise the refusal the calling agent receives, naming the tab agents
 * that own the specialist so the agent can tell the user which one to switch to.
 */
export function tabAgentDelegationError(parentAgent: string | undefined, target: string): string | undefined {
  if (!parentAgent || !isTabAgent(parentAgent) || isAllowedForTabAgent(parentAgent, target)) return undefined
  const parent = getAgentConfigKey(parentAgent)
  const key = getAgentConfigKey(target)
  const owners = Object.keys(TAB_AGENT_SPECIALISTS).filter((agent) => TAB_AGENT_SPECIALISTS[agent]?.includes(key)).map((agent) => TAB_AGENT_LABELS[agent] ?? agent)
  const what = key === "sisyphus-junior" ? "category tasks (sisyphus-junior)" : `"${key}"`
  const allowed = (TAB_AGENT_SPECIALISTS[parent] ?? []).map((agent) => (agent === "sisyphus-junior" ? "category tasks" : agent)).join(", ")
  return `${TAB_AGENT_LABELS[parent] ?? parent} cannot delegate to ${what}: it is outside this agent's role (fork roadmap 0.22). `
    + `Your specialists: ${allowed}. `
    + `If this step really needs ${what}, stop and tell the user to switch to ${owners.join(" or ")} (Tab) for it; do not work around this refusal.`
}
