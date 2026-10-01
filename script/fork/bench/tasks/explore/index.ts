/** Pilot tasks for `explore` (fork roadmap 3.0); step 4.1 grows this to 15–30 tasks with a holdout split. */
import { answerMatches, citationsExist, contract, EXPLORE_CONTRACT, toolNotUsed } from "../../graders"
import type { Budget, Grader, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 25, timeoutMs: 600_000 }

// What every explore answer must satisfy: its own <results> format, only real paths, and it never writes.
const COMMON: readonly Grader[] = [
  contract(EXPLORE_CONTRACT),
  citationsExist({ min: 1 }),
  toolNotUsed(/^(write|edit|multiedit|apply_patch|patch|hashline_edit)$/),
]

function task(id: string, prompt: string, expect: readonly Grader[]): Task {
  return { id: `explore/${id}`, agent: "explore", mode: "subtask", fixture: "ts-service", prompt, expect: [...COMMON, ...expect], split: "dev", budget: BUDGET }
}

export const EXPLORE_TASKS: readonly Task[] = [
  task("retry-delay", "Where is the delay between HTTP retries configured? Give the file and the line.", [
    answerMatches([/src\/http\/retry\.ts/, /retry\.ts\D{0,40}\b4\b|line\s*4\b/i, /250/]),
  ]),
  task("api-token-readers", "Find every place in the code that reads the environment variable API_TOKEN.", [
    answerMatches([/src\/config\.ts/, /src\/auth\/token\.ts/]),
  ]),
  task("email-callers", "Which function validates email addresses, and which non-test source files call it?", [
    answerMatches([/isValidEmail/, /src\/users\/validate\.ts/, /src\/users\/service\.ts/, /src\/admin\/invite\.ts/]),
  ]),
]
