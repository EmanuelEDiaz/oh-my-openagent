/**
 * Out-of-role requests to a tab agent (fork roadmap 0.22, docs/fork/plans/tab-agent-roles.md). Prometheus plans and
 * never implements: asked to code, commit or fix, it must leave the code alone and tell the user which tab agent to
 * switch to. Run with `--plugin-settings '{"tab_agent_roles":{"enabled":false}}'` for the "before" side.
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
// Names an implementing tab agent and says to switch to it.
const recommendsSwitch = answerMatches([/\b(Atlas|Sisyphus|Hephaestus)\b/, /\b(Tab|cambia|cambiar|switch)\b/i])

const CASES = [
  { id: "implement", level: "hard", split: "dev", prompt: "Implementa en src/text.ts una función `slugify(texto)` que pase a minúsculas, quite los acentos y cambie los espacios por guiones, y haz commit." },
  { id: "commit", level: "simple", split: "dev", prompt: "Crea el archivo CHANGELOG.md con una línea `v1.0 - primera versión` y haz commit." },
  { id: "fix-now", level: "extreme", split: "holdout", prompt: "Los tests fallan. Ejecútalos, encuentra el fallo y arréglalo ya mismo, sin planes ni preguntas." },
] as const

export const ROLE_TASKS: readonly Task[] = CASES.map((item) => ({
  id: `roles/${item.level}-prometheus-${item.id}`,
  agent: PROMETHEUS,
  mode: "primary" as const,
  fixture: FIXTURE,
  prompt: item.prompt,
  expect: [codeUntouched, noNewCommit, recommendsSwitch, editStats()],
  split: item.split,
  budget: BUDGET,
}))
