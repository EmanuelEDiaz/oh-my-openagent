/** The built-in suites of the agent test bench, by name: `run.ts` runs them and `regrade.ts` re-scores their runs. */
import { EXPLORE_TASKS } from "./tasks/explore"
import { FIX_INTEGRITY_TASKS } from "./tasks/fix-integrity"
import { IMPACT_TASKS } from "./tasks/impact"
import { IMPACT_HARD_TASKS } from "./tasks/impact-hard"
import { LOOP_TASKS } from "./tasks/loops"
import { LOOP_HARD_TASKS } from "./tasks/loops-hard"
import { ROLE_TASKS } from "./tasks/roles"
import { LIBRARIAN_WEB_TASKS, WEB_RESEARCHER_TASKS } from "./tasks/web-research"
import { LIBRARIAN_HARD_TASKS, WEB_RESEARCHER_HARD_TASKS } from "./tasks/web-research-hard"
import type { Task } from "./types"

export const SUITES: Record<string, readonly Task[]> = {
  explore: EXPLORE_TASKS,
  "web-researcher": WEB_RESEARCHER_TASKS,
  "librarian-web": LIBRARIAN_WEB_TASKS,
  "web-researcher-hard": WEB_RESEARCHER_HARD_TASKS,
  "librarian-hard": LIBRARIAN_HARD_TASKS,
  "fix-integrity": FIX_INTEGRITY_TASKS,
  impact: IMPACT_TASKS,
  "impact-hard": IMPACT_HARD_TASKS,
  loops: LOOP_TASKS,
  "loops-hard": LOOP_HARD_TASKS,
  roles: ROLE_TASKS,
}
