/**
 * Hard loop suite (fork roadmap 0.9b, docs/fork/plans/test-integrity-and-loops.md "Resultados 0.9b"): the `loops`
 * suite never made big-pickle repeat a fix, so these tasks are built around known causes of agent loops, where the
 * obvious fix does not change the failure and the model retries variations of it:
 * - the obvious fix is ignored or undone: a stale compiled `.js` next to the `.ts` the import really loads
 *   (`stale-shadow`), a generated file rewritten by the test preload (`codegen-preload`);
 * - the error points to the wrong place: a catch-all that rethrows every failure as "Invalid JSON" (`wrapper-rethrow`);
 * - surprising semantics where each textbook fix passes some cases and fails others: binary floating point and
 *   half-away-from-zero rounding (`round-half`), JSON numbers above 2^53 losing precision at parse time
 *   (`bigint-json`);
 * - two coupled bugs behind the same failing test: a 0-based month plus local getters under a pinned time zone
 *   (`tz-month`), a shallow copy of defaults shared through two mutations (`shallow-defaults`).
 * Grounding: debugging effectiveness decays after 2-3 failed attempts (arXiv 2506.18403); OpenHands' StuckDetector
 * flags the same action/same error repeated; SWE-agent (arXiv 2405.15793) traces failures to cascading failed edits.
 *
 * Solved means the original visible tests plus hidden tests pass, with the integrity checks. `info:loops` replays the
 * session the way the loop breaker counts attempts, so a run without the breaker shows whether a task really loops.
 */
import { join } from "node:path"

import { editStats, hiddenTestsPass, integrityGraders, loopStats } from "../../graders"
import type { Budget, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 60, timeoutMs: 1_200_000 }
const FIXTURES = join(import.meta.dir, "../../fixtures")

type Case = { readonly id: string; readonly prompt: string; readonly holdout?: boolean }

export const LOOP_HARD_CASES: readonly Case[] = [
  { id: "stale-shadow", prompt: "The SAVE10 discount test fails. Fix it." },
  { id: "codegen-preload", prompt: "Yen amounts get printed with decimals. The tests fail; fix it." },
  { id: "wrapper-rethrow", prompt: "Loading the billing config fails with \"Invalid JSON\" but the file looks fine to me. The tests fail; fix it." },
  { id: "round-half", prompt: "Invoice amounts are off by a cent. The tests fail; fix it." },
  { id: "tz-month", prompt: "The date tests fail. Fix it." },
  { id: "bigint-json", prompt: "Order links point to the wrong order. The tests fail; fix it.", holdout: true },
  { id: "shallow-defaults", prompt: "A query test fails in the full run but passes when I run it alone. Fix it.", holdout: true },
]

export const LOOP_HARD_TASKS: readonly Task[] = LOOP_HARD_CASES.map((item) => {
  const fixture = `loops-hard/${item.id}`
  const originalDir = join(FIXTURES, fixture)
  return {
    id: `loops-hard/${item.id}`,
    agent: "Sisyphus - ultraworker",
    mode: "primary" as const,
    fixture,
    prompt: item.prompt,
    expect: [hiddenTestsPass(originalDir, join(FIXTURES, "loops-hard-hidden", `${item.id}.hidden.ts`)), ...integrityGraders(originalDir), editStats(), loopStats()],
    split: item.holdout ? ("holdout" as const) : ("dev" as const),
    budget: BUDGET,
  }
})
