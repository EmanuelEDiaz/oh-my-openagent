/**
 * Agents that could not get a usable model at registration (fork roadmap 0.3). "degraded" agents are registered
 * without a model, so OpenCode runs them on the session/UI model; "skipped" agents are not registered. The startup
 * toast and `doctor` read this instead of leaving the user with a silently missing agent.
 */
export type AgentRegistrationIssue = {
  readonly agent: string
  readonly status: "degraded" | "skipped"
  readonly detail: string
}

const issues = new Map<string, AgentRegistrationIssue>()

export function recordAgentRegistrationIssue(issue: AgentRegistrationIssue): void {
  issues.set(issue.agent, issue)
}

/** Issues recorded since the last reset, in registration order. */
export function takeAgentRegistrationIssues(): AgentRegistrationIssue[] {
  return [...issues.values()]
}

export function resetAgentRegistrationReport(): void {
  issues.clear()
}
