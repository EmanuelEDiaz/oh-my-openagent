import type { Fixture } from "./fixtures"

/** Shared types of the agent test bench (fork roadmap 3.0, docs/fork/plans/test-bench.md). */

export type ToolCall = {
  readonly tool: string
  readonly status: string
  readonly input: Readonly<Record<string, unknown>>
  readonly error?: string
}

export type Tokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** What one evaluated session did, read back from OpenCode's messages (never from what the agent claims). */
export type Transcript = {
  /** Agent that actually produced the assistant messages (catches a silent fallback to the default agent). */
  readonly agent: string
  /** `provider/model` actually used. */
  readonly model: string
  /** Text of the last assistant message. */
  readonly answer: string
  readonly tools: readonly ToolCall[]
  readonly tokens: Tokens
  readonly cost: number
  /** Assistant messages in the session. */
  readonly turns: number
  readonly durationMs: number
  /** Agents of the child sessions (delegations). */
  readonly delegatedAgents: readonly string[]
  /** Provider or session error, if the run broke. */
  readonly error?: string
}

export type GradeContext = {
  readonly transcript: Transcript
  /** Copy of the fixture the agent worked in. */
  readonly workdir: string
  /** Injected so URL checks are testable and can be disabled offline. */
  readonly fetchStatus?: (url: string) => Promise<number>
}

export type GradeResult = { readonly name: string; readonly pass: boolean; readonly detail?: string }

export type Grader = { readonly name: string; grade(context: GradeContext): GradeResult | Promise<GradeResult> }

export type Budget = { readonly maxTokens?: number; readonly maxTurns?: number; readonly timeoutMs: number }

export type Task = {
  readonly id: string
  readonly agent: string
  /** `subtask`: a specialist runs as a real subagent; `primary`: an orchestrator gets the prompt directly. */
  readonly mode: "subtask" | "primary"
  /** A directory under script/fork/bench/fixtures/, or a git repo pinned to a commit or tag. */
  readonly fixture: Fixture
  readonly prompt: string
  readonly expect: readonly Grader[]
  /** `holdout` tasks are never looked at while tuning an agent. */
  readonly split: "dev" | "holdout"
  readonly budget: Budget
}

export type FailureKind = "infra" | "task"

export type RunResult = {
  readonly taskId: string
  readonly repeat: number
  readonly attempt: number
  /** `undefined` when the run broke on infrastructure and is not scored. */
  readonly pass?: boolean
  readonly failure?: FailureKind
  readonly grades: readonly GradeResult[]
  readonly transcript?: Transcript
  readonly error?: string
  /** Where the agent worked: lets `regrade.ts` map its absolute paths onto a fresh copy of the fixture. */
  readonly workdir?: string
}
