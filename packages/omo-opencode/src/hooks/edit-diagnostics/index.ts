/** Wires edit diagnostics into tool hooks (fork roadmap 0.9a). */
import type { PluginInput } from "@opencode-ai/plugin"

import type { EditDiagnosticsConfig } from "../../config/schema/edit-diagnostics"
import { createDaemonDiagnostics } from "../../features/edit-diagnostics/daemon-diagnostics"
import type { NewError } from "../../features/edit-diagnostics/diagnostics"
import { createEditDiagnostics } from "../../features/edit-diagnostics/service"

export function createEditDiagnosticsHook(
  ctx: PluginInput,
  config: EditDiagnosticsConfig | undefined,
  options: { readonly onNewErrors?: (sessionID: string, errors: readonly NewError[]) => void },
) {
  const notices: string[] = []
  const service = createEditDiagnostics({
    directory: ctx.directory,
    revertSyntaxErrors: config?.revert_syntax_errors !== false,
    ...(options.onNewErrors ? { onNewErrors: options.onNewErrors } : {}),
    ...(config?.use_plugin_lsp !== false ? {
      fallbackDiagnostics: createDaemonDiagnostics(ctx.directory, (extension, hint) => {
        notices.push(`[edit-diagnostics] No type checking for ${extension} files: its language server is not available. Tell the user once, and continue.\n${hint.replace(/ACTION REQUIRED[^\n]*\n?/g, "")}`)
      }),
    } : {}),
  })
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      await service.before(input.tool, input.callID, output.args ?? {})
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title?: string; output?: string; metadata?: Record<string, unknown> },
    ): Promise<void> => {
      await service.after(input, output)
      if (notices.length > 0) output.output = [output.output ?? "", ...notices.splice(0)].filter(Boolean).join("\n\n")
    },
  }
}
