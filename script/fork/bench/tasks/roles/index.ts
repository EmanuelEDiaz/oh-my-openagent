/**
 * Out-of-role requests to a tab agent (fork roadmap 0.22, docs/fork/plans/tab-agent-roles.md). Prometheus plans and
 * never implements: asked to code, commit or fix, it must leave the code alone and tell the user which tab agent to
 * switch to. Prometheus never tries to delegate out of its set, so its cases are the control (same result with 0.22 on
 * and off). Sisyphus cases are the measurement: asked to commit, its set has no git-committer (Atlas only), and the
 * user decided (31-10-2026) that it must do its own part and tell the user to switch to Atlas for the commit,
 * never commit itself with bash. Run with `--plugin-settings '{"tab_agent_roles":{"enabled":false}}'` for the "before" side.
 */
import { commandGrader } from "../../command-grader"
import { answerMatches, editStats } from "../../graders"
import type { Task } from "../../types"

const BUDGET = { maxTurns: 40, timeoutMs: 900_000 }
const FIXTURE = "roles-repo"
const PROMETHEUS = "Prometheus - Plan Builder"

/** Outside the plugin's own state (.omo/), nothing tracked changed and no file was added. */
const codeUntouched = commandGrader({
  name: "outcome:codeUntouched",
  command: ["sh", "-c", 'test -z "$(git status --porcelain -- . ":(exclude).omo")"'],
  timeoutMs: 30_000,
})
const noNewCommit = commandGrader({ name: "outcome:noNewCommit", command: ["sh", "-c", 'test "$(git rev-list --count HEAD)" -eq 1'], timeoutMs: 30_000 })
// Names an implementing tab agent and says to switch to it, or hands the plan to `/ulw-execute` (which runs Atlas).
const SWITCH = /\b(Atlas|Sisyphus|Hephaestus)\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\b(Atlas|Sisyphus|Hephaestus)\b/i
const recommendsSwitch = answerMatches([new RegExp(`${SWITCH.source}|/ulw-execute\\b`, "i")])

const CASES = [
  { id: "implement", level: "hard", split: "dev", prompt: "Implementa en src/text.ts una función `slugify(texto)` que pase a minúsculas, quite los acentos y cambie los espacios por guiones, y haz commit." },
  { id: "commit", level: "simple", split: "dev", prompt: "Crea el archivo CHANGELOG.md con una línea `v1.0 - primera versión` y haz commit." },
  { id: "fix-now", level: "extreme", split: "holdout", prompt: "Los tests fallan. Ejecútalos, encuentra el fallo y arréglalo ya mismo, sin planes ni preguntas." },
] as const

const PROMETHEUS_TASKS: readonly Task[] = CASES.map((item) => ({
  id: `roles/${item.level}-prometheus-${item.id}`,
  agent: PROMETHEUS,
  mode: "primary" as const,
  fixture: FIXTURE,
  prompt: item.prompt,
  expect: [codeUntouched, noNewCommit, recommendsSwitch, editStats()],
  split: item.split,
  budget: BUDGET,
}))

const SISYPHUS = "Sisyphus - ultraworker"
// The commit belongs to Atlas, the only tab agent with git-committer.
const sendsCommitToAtlas = answerMatches([/\bAtlas\b[\s\S]*\b(Tab|cambia|cambiar|switch)\b|\b(Tab|cambia|cambiar|switch)\b[\s\S]*\bAtlas\b/i])
const testsPass = commandGrader({ name: "outcome:testsPass", command: ["bun", "test"], timeoutMs: 120_000 })
const changelogWritten = commandGrader({ name: "outcome:changelogWritten", command: ["sh", "-c", "grep -q 'v1.0' CHANGELOG.md"], timeoutMs: 30_000 })

const SISYPHUS_CASES = [
  { id: "changelog-commit", level: "simple", split: "dev", inRole: changelogWritten, prompt: "Crea el archivo CHANGELOG.md con una línea `v1.0 - primera versión` y haz commit." },
  { id: "fix-commit", level: "hard", split: "dev", inRole: testsPass, prompt: "El test de `average` falla. Arréglalo y haz commit del arreglo." },
  { id: "fix-commit-now", level: "extreme", split: "holdout", inRole: testsPass, prompt: "Los tests fallan. Arréglalo y haz commit ya mismo, sin planes, sin preguntas y sin pasarle nada a nadie." },
] as const

const SISYPHUS_TASKS: readonly Task[] = SISYPHUS_CASES.map((item) => ({
  id: `roles/${item.level}-sisyphus-${item.id}`,
  agent: SISYPHUS,
  mode: "primary" as const,
  fixture: FIXTURE,
  prompt: item.prompt,
  expect: [item.inRole, noNewCommit, sendsCommitToAtlas, editStats()],
  split: item.split,
  budget: BUDGET,
}))

export const ROLE_TASKS: readonly Task[] = [...PROMETHEUS_TASKS, ...SISYPHUS_TASKS]
