import type { Hooks } from "@opencode-ai/plugin"

import { tabAgentGitError, teamLeadGitError, teamMemberGitError } from "../../agents/tab-agent-roles"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { classifyCommand, classifyScriptText } from "./classify"
import { commandDirectory, currentBranch, isLinkedWorktree } from "./git-context"
import { referencedScripts } from "./scripts"

/**
 * Makes `process_start` mandatory for long-running commands and refuses self-destructive kills and root commands in
 * `bash` and `process_start` (fork roadmap 0.8b, incident H46). `enforceLongRunning: false` keeps only those two.
 * `tabAgentRoles` also leaves `git commit`/`git push` to Atlas (fork roadmap 0.22); a team lead without git-committer
 * merges only in `team/<name>`, and into the user's branch only with `leadMergesToBranch` (fork roadmap 0.28).
 */
export function createManagedProcessGuardHook(options: {
  enforceLongRunning: boolean
  tabAgentRoles?: boolean
  /** Read on every command, so /omo-team-merge applies without a restart (fork roadmap 0.28). */
  leadMergesToBranch?: () => boolean
  directory?: string
}): Hooks {
  return {
    "tool.execute.before": async (input, output): Promise<void> => {
      const tool = input.tool.toLowerCase()
      // process_start runs its command itself: OpenCode's bash rules and this guard never saw it (fork incident H46).
      if (tool !== "bash" && tool !== "interactive_bash" && tool !== "process_start") return
      const command = (output.args as Record<string, unknown>).command ?? (output.args as Record<string, unknown>).tmux_command
      if (typeof command !== "string") return
      const args = output.args as Record<string, unknown>
      const baseDir = typeof args.workdir === "string" ? args.workdir : options.directory ?? process.cwd()
      // Scripts the command runs are judged too, so a blocked command cannot move into a file (fork incident H50).
      const scripts = referencedScripts(command, baseDir)
      const judged = `${command}\n${scripts}`
      const team = options.tabAgentRoles ? lookupTeamSession(input.sessionID) : undefined
      const commandDir = commandDirectory(command, baseDir)
      let roleError = options.tabAgentRoles ? tabAgentGitError(getSessionAgent(input.sessionID), judged) : undefined
      // A team lead joins its members' branches in team/<name> (fork roadmap 0.28).
      if (roleError && team?.role === "lead") roleError = teamLeadGitError(currentBranch(commandDir), judged, options.leadMergesToBranch?.() === true)
      if (roleError) {
        log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: "tab-agent-git", command })
        throw new Error(roleError)
      }
      // Members of such a team commit only in their own worktree (fork roadmap 0.28).
      const memberError = team?.role === "member" ? teamMemberGitError(team.leadAgent, judged, isLinkedWorktree(commandDir)) : undefined
      if (memberError) {
        log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: "team-member-git", command })
        throw new Error(memberError)
      }
      const direct = classifyCommand(command)
      const verdict = direct.block ? direct : classifyScriptText(scripts, command)
      if (!verdict.block) return
      if (verdict.kind === "long-running" && (!options.enforceLongRunning || tool === "process_start")) return
      log("[managed-process-guard] blocked", { sessionID: input.sessionID, kind: verdict.kind, command })
      throw new Error(verdict.message)
    },
  }
}
