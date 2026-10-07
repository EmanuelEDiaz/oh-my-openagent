/**
 * Agents that could not get a usable model at registration (fork roadmap 0.3). "degraded" agents are registered
 * without a model, so OpenCode runs them on the session/UI model; "skipped" agents are not registered; "replaced"
 * agents had a configured model its provider no longer offers and use `to` instead, or the session model without it
 * (fork roadmap 0.7). The startup toast and `doctor` read this instead of leaving the user with a silently missing agent.
 */
export type AgentRegistrationIssue = {
  readonly agent: string
  /** "notice": a model setting outside the agents worth a startup warning (e.g. a paid `small_model`, plan A5). */
  readonly status: "degraded" | "skipped" | "replaced" | "notice"
  readonly detail: string
  readonly from?: string
  readonly to?: string
}

const issues = new Map<string, AgentRegistrationIssue>()
const configuredModels = new Map<string, string>()

/** The model the user configured for an agent, re-checked once the provider list is refreshed (fork roadmap 0.7). */
export function recordConfiguredModel(agent: string, model: string | undefined): void {
  if (model) configuredModels.set(agent, model)
}

export function takeConfiguredModels(): ReadonlyMap<string, string> {
  return new Map(configuredModels)
}

export function recordAgentRegistrationIssue(issue: AgentRegistrationIssue): void {
  issues.set(issue.agent, issue)
}

/** Issues recorded since the last reset, in registration order. */
export function takeAgentRegistrationIssues(): AgentRegistrationIssue[] {
  return [...issues.values()]
}

export function resetAgentRegistrationReport(): void {
  issues.clear()
  configuredModels.clear()
}
