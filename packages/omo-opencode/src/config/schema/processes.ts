import { z } from "zod"

/** Managed background processes (fork roadmap 0.8b). */
export const ProcessesConfigSchema = z.object({
  /** process_* tools and the managed process manager (default: true) */
  enabled: z.boolean().default(true),
  /** Block long-running commands in bash so they must go through process_start (default: true) */
  enforce: z.boolean().default(true),
  /** Warn the user and the agent (never kill) when a process runs longer than this (default: 2 h) */
  timeout_ms: z.number().int().min(60_000).default(7_200_000),
})

export type ProcessesConfig = z.infer<typeof ProcessesConfigSchema>
