import { z } from "zod"

/** Silent model stalls (fork roadmap 0.8): cut stalled streams and recover instead of waiting forever. */
export const StallConfigSchema = z.object({
  /** Stall watchdog on sessions and delegated tasks (default: true) */
  enabled: z.boolean().default(true),
  /**
   * Default `chunkTimeout` for providers that set none, so a stalled stream fails as a retryable error instead of
   * hanging. A value set in opencode.json always wins. `false` leaves providers untouched.
   */
  chunk_timeout_ms: z.union([z.number().int().min(10_000), z.literal(false)]).default(90_000),
  /**
   * Default `headerTimeout` (wait for the response headers, before any chunk) for providers that set none, including
   * `opencode`; openai keeps OpenCode's own 300 s. A value set in opencode.json always wins. `false` leaves it unset.
   */
  header_timeout_ms: z.union([z.number().int().min(10_000), z.literal(false)]).default(120_000),
  /** A busy session with no new output, no running tool and no managed process for this long is stalled */
  inactivity_ms: z.number().int().min(60_000).default(240_000),
  /** How often busy sessions are checked */
  check_interval_ms: z.number().int().min(1000).default(15_000),
  /** Stalls tolerated per task before it is paused and the user is told */
  max_stalls_per_task: z.number().int().min(1).max(5).default(2),
})

export type StallConfig = z.infer<typeof StallConfigSchema>
