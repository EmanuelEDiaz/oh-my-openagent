import { z } from "zod"

/** Lossless resume (fork roadmap 0.8c). */
export const ResumeConfigSchema = z.object({
  /** Resume cards, SIGTERM save, memory watch, resume_task and /omo-resume (default: true) */
  enabled: z.boolean().default(true),
  /** Warn and save resume cards when OpenCode's memory passes this (default: 1228 MB = 1.2 GB) */
  memory_limit_mb: z.number().int().min(256).default(1228),
  /** ...or when the system's used memory passes this percentage (default: 85) */
  system_memory_percent: z.number().int().min(50).max(99).default(85),
  /** How often memory is checked (default: 30 s) */
  memory_check_interval_ms: z.number().int().min(5000).default(30_000),
})

export type ResumeConfig = z.infer<typeof ResumeConfigSchema>
