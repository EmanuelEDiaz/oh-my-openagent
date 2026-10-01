import type { PluginInput } from "@opencode-ai/plugin"
import type { AgentRegistrationIssue } from "../../../shared/agent-registration-report"
import { takeAgentRegistrationIssues } from "../../../shared/agent-registration-report"
import { log } from "../../../shared/logger"
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

/** Startup message for agents registered without a usable model (fork roadmap 0.3); undefined when all is well. */
export function formatAgentRegistrationWarning(issues: readonly AgentRegistrationIssue[]): string | undefined {
  const degraded = issues.filter((issue) => issue.status === "degraded").map((issue) => issue.agent).sort(byPriority)
  const skipped = issues.filter((issue) => issue.status === "skipped")
  if (degraded.length === 0 && skipped.length === 0) return undefined
  const lines: string[] = []
  if (degraded.length > 0) lines.push(`No configured model for: ${list(degraded)} — they use your session model.`)
  for (const issue of skipped) lines.push(`${issue.agent} is off: ${issue.detail}.`)
  lines.push("Pick models with /omo-models (or `oh-my-openagent config models`).")
  return lines.join("\n")
}

export async function showAgentRegistrationWarningIfNeeded(ctx: PluginInput): Promise<void> {
  const message = formatAgentRegistrationWarning(takeAgentRegistrationIssues())
  if (!message) return
  await ctx.client.tui
    .showToast({ body: { title: "Agent models", message, variant: "warning" as const, duration: 12000 } })
    .catch(ignoreToastError)
  log("[auto-update-checker] Agent registration warning shown", { message })
}
