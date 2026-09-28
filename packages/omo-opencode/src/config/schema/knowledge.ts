import { z } from "zod"

export const KnowledgeConfigSchema = z.object({
  /** Project knowledge index + knowledge_search tool (default: true) */
  enabled: z.boolean().default(true),
  /** Extra files or directories (relative to the project) whose markdown is indexed */
  include_paths: z.array(z.string()).optional(),
  /** How many recent commits are indexed (default: 500, 0 disables git indexing) */
  git_commits: z.number().int().min(0).max(5000).default(500),
  /** Index OpenCode session conversations (read-only) so answers can cite ses_…/msg_…/prt_… (default: true) */
  index_sessions: z.boolean().default(true),
  /** Unreferenced sessions older than this leave the index (the OpenCode database is never modified) */
  session_retention_days: z.number().int().min(1).default(180),
  /** Size budget for the session index; oldest unreferenced sessions are pruned first (default: 200) */
  max_index_mb: z.number().min(10).default(200),
})

export type KnowledgeConfig = z.infer<typeof KnowledgeConfigSchema>
