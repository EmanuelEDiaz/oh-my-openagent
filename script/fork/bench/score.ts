/** Failure classification and pass@1 / pass^k aggregation for the agent test bench. */
import type { FailureKind, RunResult, Transcript } from "./types"

// The machine lost its connection (DNS or route gone): worth waiting for, not just retrying at once.
const CONNECTIVITY_PATTERN = /upstream unreachable|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i

export function isConnectivityError(error: string): boolean {
  return CONNECTIVITY_PATTERN.test(error)
}

// Problems of the provider or the transport, not of the agent: they are retried and never scored.
const INFRA_PATTERNS = [
  CONNECTIVITY_PATTERN,
  /\b403\b/,
  /\b429\b/,
  /\b50[0-4]\b/,
  /rate.?limit/i,
  /too many requests/i,
  /free tier/i,
  /usage limit|quota/i,
  /overloaded/i,
  // Zen's own gateway when a free model's endpoint is down (seen with ling-3.1-flash-free, 07-10-2026).
  /Upstream request failed|Endpoint is unavailable|service unavailable/i,
  /timed out|stalled|never started|no assistant message in the session|MessageAbortedError/i,
  /ProviderAuthError/i,
  /server did not start|server error|server unresponsive/i,
  /model produced no output/i,
]

// The provider's quota is spent (Zen's free models, 27-10-2026): nothing will answer until it resets, so the run stops
// and is resumed later. A passing 429 or rate limit is not this.
const QUOTA_PATTERN = /usage limit reached|usage exceeded|FreeUsageLimit|free_tier_limit|quota exceeded|insufficient_quota/i

export function isQuotaError(error: string): boolean {
  return QUOTA_PATTERN.test(error)
}

// The setup is wrong (e.g. a model OpenCode retired is still configured): retrying cannot help, the run stops.
const CONFIG_PATTERNS = [/model not found/i, /agent not found/i, /ProviderModelNotFound|ModelNotFound/i]

export function isConfigError(error: string): boolean {
  return CONFIG_PATTERNS.some((pattern) => pattern.test(error))
}

/**
 * A turn where the model never answered: no tokens, no tool call, no text, and no error from OpenCode either (seen
 * on 14-10-2026 while the connection was down). There is nothing of the agent's to score.
 */
export function silentModelError(transcript: Transcript): string | undefined {
  const tokens = Object.values(transcript.tokens).reduce((sum, value) => sum + value, 0)
  if (tokens > 0 || transcript.tools.length > 0 || transcript.answer.trim() !== "") return undefined
  return `model produced no output (0 tokens, no tool calls, empty answer after ${Math.round(transcript.durationMs / 1000)}s)`
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
