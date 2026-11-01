import type { Hooks } from "@opencode-ai/plugin"

import { tabAgentGitError } from "../../agents/tab-agent-roles"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { classifyCommand } from "./classify"

/**
 * Makes `process_start` mandatory for long-running commands and refuses self-destructive kills and root commands in
 * `bash` and `process_start` (fork roadmap 0.8b, incident H46). `enforceLongRunning: false` keeps only those two.
 * `tabAgentRoles` also leaves `git commit`/`git push` to Atlas (fork roadmap 0.22).
 */
export function createManagedProcessGuardHook(options: { enforceLongRunning: boolean; tabAgentRoles?: boolean }): Hooks {
  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      const tool = input.tool.toLowerCase()
      // process_start runs its command itself: OpenCode's bash rules and this guard never saw it (fork incident H46).
      if (tool !== "bash" && tool !== "interactive_bash" && tool !== "process_start") return
      const command = (output.args as Record<string, unknown>).command ?? (output.args as Record<string, unknown>).tmux_command
      if (typeof command !== "string") return
      const roleError = options.tabAgentRoles ? tabAgentGitError(getSessionAgent(input.sessionID), command) : undefined
      if (roleError) {
        log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: "tab-agent-git", command })
        throw new Error(roleError)
      }
      const verdict = classifyCommand(command)
      if (!verdict.block) return
      if (verdict.kind === "long-running" && (!options.enforceLongRunning || tool === "process_start")) return
      log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: verdict.kind, command })
      throw new Error(verdict.message)
    },
  }
}
