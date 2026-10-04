/**
 * Loop suite (fork roadmap 0.9b, docs/fork/plans/test-integrity-and-loops.md "Medición de eficacia"): hard bugs whose
 * error points at the wrong place (a validator when the cause is an env default two modules away, a "flaky" test caused
 * by shared module state, a locale-dependent sort, CRLF input, a `once` that never unsubscribes, a memo key that
 * ignores arguments, a global regex's lastIndex, `Boolean("false")`).
 *
 * Solved means the original visible tests plus hidden tests pass. Turns and tokens come from withinBudget;
 * `info:edits` records repeated identical edits without failing the task.
 */
import { join } from "node:path"

import { editStats, hiddenTestsPass, integrityGraders } from "../../graders"
import type { Budget, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 60, timeoutMs: 1_200_000 }
const FIXTURES = join(import.meta.dir, "../../fixtures")

type Case = { readonly id: string; readonly prompt: string; readonly holdout?: boolean }

const CASES: readonly Case[] = [
  { id: "config-default", prompt: "Creating a post fails validation even for a normal post. The tests show it; please fix it." },
  { id: "shared-state", prompt: "One of the pricer tests is flaky: it passes alone but fails in the full run. Fix it." },
  { id: "locale-sort", prompt: "The index rendering test fails. Please fix it." },
  { id: "once-listener", prompt: "The audit test fails: entries get recorded twice. Fix it." },
  { id: "memo-key", prompt: "Viewers are getting admin permissions according to the tests. Please fix it." },
  { id: "regex-lastindex", prompt: "The second request with a valid token gets rejected. The tests reproduce it; please fix it." },
  { id: "csv-crlf", prompt: "The ledger totals test fails. Fix it.", holdout: true },
  { id: "env-bool", prompt: "Ops can't switch the promo banner off. The failing test shows it; please fix it.", holdout: true },
]

export const LOOP_TASKS: readonly Task[] = CASES.map((item) => {
  const fixture = `loops/${item.id}`
  const originalDir = join(FIXTURES, fixture)
  return {
    id: `loops/${item.id}`,
    agent: "sisyphus",
    mode: "primary" as const,
    fixture,
    prompt: item.prompt,
    expect: [hiddenTestsPass(originalDir, join(FIXTURES, "loops-hidden", `${item.id}.hidden.ts`)), ...integrityGraders(originalDir), editStats()],
    split: item.holdout ? ("holdout" as const) : ("dev" as const),
    budget: BUDGET,
  }
})
