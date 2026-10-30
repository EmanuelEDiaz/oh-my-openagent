/** Wires edit diagnostics into tool hooks (fork roadmap 0.9a). */
import { readFileSync } from "node:fs"
import { relative } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import type { EditDiagnosticsConfig } from "../../config/schema/edit-diagnostics"
import { createDaemonDiagnostics } from "../../features/edit-diagnostics/daemon-diagnostics"
import type { NewError } from "../../features/edit-diagnostics/diagnostics"
import { createEditDiagnostics } from "../../features/edit-diagnostics/service"
import { shellWriteTargets } from "../../shared"

type ShellTarget = { readonly path: string; readonly callID: string; readonly original: string }

function readOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return ""
  }
}

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
  // Files a bash call rewrites in place go through the same checks as a write (docs/fork/plans/shell-writes.md).
  const shellCalls = new Map<string, ShellTarget[]>()
  const checkShellWrites = config?.shell_writes !== false
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      const command = output.args?.["command"]
      if (checkShellWrites && input.tool.toLowerCase() === "bash" && typeof command === "string") {
        const targets = shellWriteTargets(command, ctx.directory).map((path, index) => ({ path, callID: `${input.callID}#shell-${index}`, original: readOrEmpty(path) }))
        if (targets.length === 0) return
        for (const target of targets) await service.before("write", target.callID, { filePath: target.path })
        shellCalls.set(input.callID, targets)
        if (shellCalls.size > 200) shellCalls.delete(shellCalls.keys().next().value as string)
        return
      }
      await service.before(input.tool, input.callID, output.args ?? {})
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title?: string; output?: string; metadata?: Record<string, unknown> },
    ): Promise<void> => {
      const shellTargets = shellCalls.get(input.callID)
      shellCalls.delete(input.callID)
      if (shellTargets !== undefined) {
        const changed = shellTargets.filter((target) => readOrEmpty(target.path) !== target.original)
        for (const target of changed) await service.after({ tool: "write", sessionID: input.sessionID, callID: target.callID }, output)
        if (changed.length > 0) {
          const files = changed.map((target) => relative(ctx.directory, target.path)).join(", ")
          output.output = [output.output ?? "", `[shell-write] ${files} rewritten through the shell. Use the edit or write tool for existing files: the shell skips the plugin's checks on edits (they ran on this one now).`].filter(Boolean).join("\n\n")
        }
        return
      }
      await service.after(input, output)
      if (notices.length > 0) output.output = [output.output ?? "", ...notices.splice(0)].filter(Boolean).join("\n\n")
    },
  }
}
