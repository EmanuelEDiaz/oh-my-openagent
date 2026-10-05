import { z } from "zod"

/** Network cuts, freezes and killed processes (fork roadmap 0.15): wait and resume instead of failing over. */
export const ResilienceConfigSchema = z.object({
  /** Recognise network cuts, freezes and orphaned work (default: true) */
  enabled: z.boolean().default(true),
  /** Connectivity probes after OpenCode's own retry gives up, before a resume card is written */
  network_probe_limit: z.number().int().min(1).max(100).default(12),
  /** Waits between probes in seconds (the last one repeats); each gets ±25 % jitter */
  network_backoff_s: z.array(z.number().positive()).min(1).default([5, 15, 30, 60]),
  /** HTTPS URL probed next to the provider to tell "our network is down" from "the provider is down" */
  neutral_probe_url: z.string().url().default("https://www.gstatic.com/generate_204"),
  /** A busy session without stream data for this long triggers a probe (a dead connection may hang silently) */
  silent_stream_s: z.number().int().min(10).default(60),
  /** A monotonic-clock jump above the expected tick by more than this counts as a freeze */
  freeze_threshold_s: z.number().int().min(2).default(10),
  /** Heartbeat of the work-in-progress marker */
  wip_heartbeat_s: z.number().int().min(5).default(15),
  /** New subagents wait in a queue below this available memory (MB) … */
  low_memory_mb: z.number().int().min(0).default(700),
  /** … or below this share of total memory */
  low_memory_ratio: z.number().min(0).max(1).default(0.1),
  /** … and are admitted again from this available memory (MB) */
  resume_memory_mb: z.number().int().min(0).default(900),
})

export type ResilienceConfig = z.infer<typeof ResilienceConfigSchema>
