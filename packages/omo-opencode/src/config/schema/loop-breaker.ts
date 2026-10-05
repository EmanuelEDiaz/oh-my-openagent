import { z } from "zod"

/** Loop breaker (fork roadmap 0.9b): the same error after repeated fixes escalates instead of looping. */
export const LoopBreakerConfigSchema = z.object({
  /** Detect repeated errors across turns and escalate (default: true) */
  enabled: z.boolean().default(true),
  /** Failed fixes of the same error before: a nudge to change hypothesis */
  nudge_after: z.number().int().min(1).default(2),
  /** … web research and a fresh debugger before more edits */
  research_after: z.number().int().min(2).default(3),
  /** … edits to those files blocked until the user chooses (an almost identical fix also triggers it) */
  block_after: z.number().int().min(3).default(4),
})

/** One retry budget per task, shared by stall recovery and the loop breaker (fork roadmap 0.8/0.9). */
export const RetryBudgetConfigSchema = z.object({
  /** Escalations and stall recoveries per task before the work is paused and the user is told */
  max_per_task: z.number().int().min(1).max(20).default(6),
})

export type LoopBreakerConfig = z.infer<typeof LoopBreakerConfigSchema>
export type RetryBudgetConfig = z.infer<typeof RetryBudgetConfigSchema>
