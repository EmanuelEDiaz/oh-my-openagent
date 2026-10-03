import { z } from "zod"

/** After each edit, only the errors it introduced; edits that break the syntax are undone (fork roadmap 0.9a). */
export const EditDiagnosticsConfigSchema = z.object({
  /** Report only new errors after edits (default: true) */
  enabled: z.boolean().default(true),
  /** Undo an edit that introduces a syntax error (default: true) */
  revert_syntax_errors: z.boolean().default(true),
  /**
   * Ask the plugin's shared LSP daemon for errors when OpenCode reports none (default: true). One daemon serves every
   * OpenCode window; it needs the language servers installed (e.g. typescript-language-server, pyright).
   */
  use_plugin_lsp: z.boolean().default(true),
})

export type EditDiagnosticsConfig = z.infer<typeof EditDiagnosticsConfigSchema>
