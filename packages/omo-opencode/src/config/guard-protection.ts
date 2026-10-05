/**
 * Guards are switched off only by the user (fork roadmap 0.18, closed early on 05-10-2026). Project config lives in the
 * repository, where the agent can write: a project `omo.jsonc` could otherwise disable the test guard and the next
 * session would start without it (incident: techmefr/forge-ops#403). So the guard hooks in `disabled_hooks` and the
 * guards' own settings are taken from the user's config only; what a project tried is reported, never applied.
 */
import type { OhMyOpenCodeConfig } from "./schema"

/** Hooks that keep the agent honest or the work safe. */
export const GUARD_HOOKS: readonly string[] = [
  "test-integrity-guard",
  "edit-diagnostics",
  "loop-breaker",
  "stall-watchdog",
  "evidence-gate",
  "citation-check",
  "managed-process-guard",
  "web-research-verdict",
  "write-existing-file-guard",
  "bash-file-read-guard",
]

/** Settings sections of those guards (and the Zen gate and the network guard). */
export const GUARD_SECTIONS = ["test_integrity", "edit_diagnostics", "loop_breaker", "retry_budget", "resilience", "stall", "zen_free_gate"] as const

export type GuardProtection = { readonly config: OhMyOpenCodeConfig; readonly ignored: readonly string[] }

export function protectGuards(config: OhMyOpenCodeConfig, userConfig: Partial<OhMyOpenCodeConfig>): GuardProtection {
  const ignored: string[] = []
  const userDisabled = new Set(userConfig.disabled_hooks ?? [])
  const disabledHooks = (config.disabled_hooks ?? []).filter((hook) => {
    if (!GUARD_HOOKS.includes(hook) || userDisabled.has(hook)) return true
    ignored.push(`disabled_hooks: ${hook}`)
    return false
  })
  const next: Record<string, unknown> = { ...config, disabled_hooks: disabledHooks }
  for (const section of GUARD_SECTIONS) {
    const merged = (config as Record<string, unknown>)[section]
    const user = (userConfig as Record<string, unknown>)[section]
    if (JSON.stringify(merged) === JSON.stringify(user)) continue
    ignored.push(section)
    if (user === undefined) delete next[section]
    else next[section] = user
  }
  const userGate = userConfig.knowledge?.evidence_gate
  if (config.knowledge && config.knowledge.evidence_gate !== (userGate ?? "block")) {
    ignored.push("knowledge.evidence_gate")
    next["knowledge"] = { ...config.knowledge, evidence_gate: userGate ?? "block" }
  }
  return { config: next as OhMyOpenCodeConfig, ignored }
}
