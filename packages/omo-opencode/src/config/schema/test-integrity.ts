import { z } from "zod"

/** Test integrity (fork roadmap 0.9a): existing tests are read-only while fixing; cheating edits are refused. */
export const TestIntegrityConfigSchema = z.object({
  /** Guard tests and judge new tests by whether they fail before the fix (default: true) */
  enabled: z.boolean().default(true),
  /** Refuse new type escapes (any, as unknown as, x!), swallowed errors and loosened type/lint config (fork roadmap 0.9c; default: true) */
  type_errors: z.boolean().default(true),
})

export type TestIntegrityConfig = z.infer<typeof TestIntegrityConfigSchema>
