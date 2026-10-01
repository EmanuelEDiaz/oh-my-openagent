/** Failure classification and pass@1 / pass^k aggregation for the agent test bench. */
import type { FailureKind, RunResult } from "./types"

// Problems of the provider or the transport, not of the agent: they are retried and never scored.
const INFRA_PATTERNS = [
  /\b403\b/,
  /\b429\b/,
  /\b50[0-4]\b/,
  /rate.?limit/i,
  /too many requests/i,
  /free tier/i,
  /usage limit|quota/i,
  /overloaded/i,
  /timed out|stalled/i,
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i,
  /ProviderAuthError/i,
  /server did not start/i,
]

// The setup is wrong (e.g. a model OpenCode retired is still configured): retrying cannot help, the run stops.
const CONFIG_PATTERNS = [/model not found/i, /agent not found/i, /ProviderModelNotFound|ModelNotFound/i]

export function isConfigError(error: string): boolean {
  return CONFIG_PATTERNS.some((pattern) => pattern.test(error))
}

export function classifyFailure(error: string): FailureKind {
  return isConfigError(error) || INFRA_PATTERNS.some((pattern) => pattern.test(error)) ? "infra" : "task"
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let value = 1
  for (let index = 1; index <= k; index++) value = (value * (n - k + index)) / index
  return value
}

/** Unbiased pass^k (tau-bench): probability that k runs drawn without replacement from n all pass. */
export function passHatK(n: number, passed: number, k: number): number | undefined {
  if (n < k) return undefined
  return choose(passed, k) / choose(n, k)
}

export type TaskSummary = {
  readonly taskId: string
  readonly scored: number
  readonly passed: number
  readonly passAt1: number
  readonly passHatK?: number
  readonly infraFailures: number
  /** Grader name → number of scored runs it failed. */
  readonly failedGraders: Readonly<Record<string, number>>
}

export type Summary = {
  readonly k: number
  readonly passAt1: number
  /** Mean over the tasks that have at least k scored runs. */
  readonly passHatK?: number
  readonly infraFailures: number
  readonly meanTokens: number
  readonly meanTurns: number
  readonly meanDurationMs: number
  readonly models: readonly string[]
  readonly tasks: readonly TaskSummary[]
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function summarize(results: readonly RunResult[], k: number): Summary {
  const scored = results.filter((run) => run.pass !== undefined)
  const taskIds = [...new Set(results.map((run) => run.taskId))]
  const tasks = taskIds.map((taskId): TaskSummary => {
    const runs = scored.filter((run) => run.taskId === taskId)
    const passed = runs.filter((run) => run.pass).length
    const failedGraders: Record<string, number> = {}
    for (const grade of runs.flatMap((run) => run.grades.filter((entry) => !entry.pass))) {
      failedGraders[grade.name] = (failedGraders[grade.name] ?? 0) + 1
    }
    const hat = passHatK(runs.length, passed, k)
    return {
      taskId,
      scored: runs.length,
      passed,
      passAt1: runs.length === 0 ? 0 : passed / runs.length,
      ...(hat === undefined ? {} : { passHatK: hat }),
      infraFailures: results.filter((run) => run.taskId === taskId && run.failure === "infra").length,
      failedGraders,
    }
  })
  const withHat = tasks.filter((task) => task.passHatK !== undefined).map((task) => task.passHatK ?? 0)
  const transcripts = scored.flatMap((run) => (run.transcript ? [run.transcript] : []))
  return {
    k,
    passAt1: mean(tasks.filter((task) => task.scored > 0).map((task) => task.passAt1)),
    ...(withHat.length === 0 ? {} : { passHatK: mean(withHat) }),
    infraFailures: results.filter((run) => run.failure === "infra").length,
    meanTokens: mean(transcripts.map((transcript) => transcript.tokens.input + transcript.tokens.output + transcript.tokens.reasoning)),
    meanTurns: mean(transcripts.map((transcript) => transcript.turns)),
    meanDurationMs: mean(transcripts.map((transcript) => transcript.durationMs)),
    models: [...new Set(transcripts.map((transcript) => transcript.model))],
    tasks,
  }
}
