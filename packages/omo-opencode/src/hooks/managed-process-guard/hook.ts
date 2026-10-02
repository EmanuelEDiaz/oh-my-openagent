import type { Hooks } from "@opencode-ai/plugin"

import { log } from "../../shared/logger"
import { classifyCommand } from "./classify"

/**
 * Makes `process_start` mandatory for long-running commands and refuses self-destructive kills in `bash`
 * (fork roadmap 0.8b). `enforceLongRunning: false` keeps only the self-kill protection.
 */
export function createManagedProcessGuardHook(options: { enforceLongRunning: boolean }): Hooks {
  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      const tool = input.tool.toLowerCase()
      if (tool !== "bash" && tool !== "interactive_bash") return
      const command = (output.args as Record<string, unknown>).command ?? (output.args as Record<string, unknown>).tmux_command
      if (typeof command !== "string") return
      const verdict = classifyCommand(command)
      if (!verdict.block) return
      if (verdict.kind === "long-running" && !options.enforceLongRunning) return
      log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: verdict.kind, command })
      throw new Error(verdict.message)
    },
  }
}
