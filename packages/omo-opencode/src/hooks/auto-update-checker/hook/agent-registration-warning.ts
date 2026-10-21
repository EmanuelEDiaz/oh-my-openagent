import type { PluginInput } from "@opencode-ai/plugin"
import { isKnownMissingModel } from "@oh-my-opencode/model-core"

import type { AgentRegistrationIssue } from "../../../shared/agent-registration-report"
import { takeAgentRegistrationIssues, takeConfiguredModels } from "../../../shared/agent-registration-report"
import { readConnectedProvidersCache } from "../../../shared/connected-providers-cache"
import { log } from "../../../shared/logger"
import { fetchAvailableModels } from "../../../shared/model-availability"
import { ignoreToastError } from "./ignore-toast-error"

const MAX_LISTED = 6
/** Orchestrators the user switches between with Tab come first, so they are never hidden behind "+N". */
const PRIORITY = ["sisyphus", "atlas", "prometheus", "hephaestus"]

function byPriority(left: string, right: string): number {
  const rank = (agent: string) => (PRIORITY.includes(agent) ? PRIORITY.indexOf(agent) : PRIORITY.length)
  return rank(left) - rank(right)
}

function list(agents: readonly string[]): string {
  return agents.length <= MAX_LISTED ? agents.join(", ") : `${agents.slice(0, MAX_LISTED).join(", ")} +${agents.length - MAX_LISTED}`
}

/** Startup message for agents registered without a usable model (fork roadmap 0.3, 0.7); undefined when all is well. */
export function formatAgentRegistrationWarning(issues: readonly AgentRegistrationIssue[]): string | undefined {
  const degraded = issues.filter((issue) => issue.status === "degraded").map((issue) => issue.agent).sort(byPriority)
  const skipped = issues.filter((issue) => issue.status === "skipped")
  const replaced = issues
    .filter((issue) => issue.status === "replaced")
    .sort((left, right) => byPriority(left.agent, right.agent))
    .map((issue) => `${issue.agent} (${issue.from} → ${issue.to ?? "session model"})`)
  const notices = issues.filter((issue) => issue.status === "notice").map((issue) => issue.detail)
  if (degraded.length === 0 && skipped.length === 0 && replaced.length === 0 && notices.length === 0) return undefined
  const lines: string[] = [...notices]
  if (degraded.length === 0 && skipped.length === 0 && replaced.length === 0) return lines.join("\n")
  if (replaced.length > 0) lines.push(`Retired by their provider: ${list(replaced)}.`)
  if (degraded.length > 0) lines.push(`No configured model for: ${list(degraded)} — they use your session model.`)
  for (const issue of skipped) lines.push(`${issue.agent} is off: ${issue.detail}.`)
  lines.push("Pick models with /omo-models (or `oh-my-openagent config models`).")
  return lines.join("\n")
}

/**
 * Registration reads the provider list cached by the previous run, so a model retired since then slips through.
 * Once the list is refreshed, configured models it no longer offers are reported too; delegations already skip them
 * (fork roadmap 0.7).
 */
export function findRetiredConfiguredModels(
  configured: ReadonlyMap<string, string>,
  available: ReadonlySet<string>,
  alreadyReported: readonly AgentRegistrationIssue[],
): AgentRegistrationIssue[] {
  const reported = new Set(alreadyReported.filter((issue) => issue.status === "replaced").map((issue) => issue.agent))
  return [...configured]
    .filter(([agent, model]) => !reported.has(agent) && isKnownMissingModel(model, available))
    .map(([agent, model]) => ({
      agent,
      status: "replaced" as const,
      detail: `${model} is no longer offered; delegations use another model`,
      from: model,
    }))
}

async function refreshedAvailableModels(): Promise<ReadonlySet<string>> {
  const connectedProviders = readConnectedProvidersCache()
  return connectedProviders ? fetchAvailableModels(undefined, { connectedProviders }) : new Set()
}

export async function showAgentRegistrationWarningIfNeeded(
  ctx: PluginInput,
  loadAvailableModels: () => Promise<ReadonlySet<string>> = refreshedAvailableModels,
): Promise<void> {
  const issues = takeAgentRegistrationIssues()
  const late = findRetiredConfiguredModels(takeConfiguredModels(), await loadAvailableModels().catch(() => new Set<string>()), issues)
  const message = formatAgentRegistrationWarning([...issues, ...late])
  if (!message) return
  await ctx.client.tui
    .showToast({ body: { title: "Agent models", message, variant: "warning" as const, duration: 12000 } })
    .catch(ignoreToastError)
  log("[auto-update-checker] Agent registration warning shown", { message })
}
