import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { z } from "zod"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { approveShutdown, deleteTeam, rejectShutdown, requestShutdownOfMember } from "../team-runtime/shutdown"
import { listActiveTeams, loadRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { resolveParticipant, type TeamLifecycleToolContext, type TeamRuntimeStoreDeps } from "./lifecycle-participant"

const TeamDeleteArgsSchema = z.object({ teamRunId: z.string().min(1), force: z.boolean().optional() })
const TeamShutdownRequestArgsSchema = z.object({ teamRunId: z.string().min(1), targetMemberName: z.string().min(1) })
const TeamApproveShutdownArgsSchema = z.object({ teamRunId: z.string().min(1), memberName: z.string().min(1) })
const TeamRejectShutdownArgsSchema = z.object({
  teamRunId: z.string().min(1),
  memberName: z.string().min(1),
  reason: z.string().min(1),
})

type TeamShutdownToolDeps = TeamRuntimeStoreDeps & {
  deleteTeam: typeof deleteTeam
  requestShutdownOfMember: typeof requestShutdownOfMember
  approveShutdown: typeof approveShutdown
  rejectShutdown: typeof rejectShutdown
}

const defaultTeamShutdownToolDeps: TeamShutdownToolDeps = {
  listActiveTeams,
  loadRuntimeState,
  deleteTeam,
  requestShutdownOfMember,
  approveShutdown,
  rejectShutdown,
}

/** Why team_delete was refused and the two ways forward (continue the lead session, or the CLI). */
export function teamDeleteLeadOnlyMessage(runtimeState: { teamRunId: string; teamName: string; status: string; leadSessionId?: string }): string {
  const lead = runtimeState.leadSessionId
  const how = lead
    ? `led by session ${lead} (status ${runtimeState.status}). Continue it with \`opencode run --session ${lead}\`, or delete it from a terminal with \`oh-my-openagent team delete ${runtimeState.teamRunId} --force\``
    : `has no recorded lead session (status ${runtimeState.status}). Delete it from a terminal with \`oh-my-openagent team delete ${runtimeState.teamRunId} --force\``
  return `team_delete is lead-only: team ${runtimeState.teamName} (${runtimeState.teamRunId}) is ${how}.`
}

export function createTeamDeleteTool(
  config: TeamModeConfig,
  client: OpencodeClient,
  backgroundManager: BackgroundManager,
  tmuxMgr?: TmuxSessionManager,
  deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps,
): ToolDefinition {
  void client

  return tool({
    description: "Delete a completed or shutdown-approved team run. Pass force=true to tear it down even while members are still active.",
    args: { teamRunId: tool.schema.string(), force: tool.schema.boolean().optional() },
    async execute(rawArgs, toolContext) {
      const args = TeamDeleteArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { runtimeState, participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      const isOrphanedForceDelete = args.force === true && runtimeState.status === "orphaned"
      const isStuckDeletingForceDelete = args.force === true && runtimeState.status === "deleting"
      // An orphaned or stuck-deleting team has no live lead to ask, so any session (including one from a later
      // `opencode run`) may force its cleanup; active teams stay lead-only.
      const isForceBypass = isStuckDeletingForceDelete || isOrphanedForceDelete
      if (!isForceBypass && participant?.role !== "lead") {
        throw new Error(teamDeleteLeadOnlyMessage(runtimeState))
      }
      return JSON.stringify({ teamRunId: args.teamRunId, teamName: runtimeState.teamName, deleted: true, ...(await deps.deleteTeam(args.teamRunId, config, tmuxMgr, backgroundManager, { force: args.force })) })
    },
  })
}

export function createTeamShutdownRequestTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Request shutdown for a team member.",
    args: { teamRunId: tool.schema.string(), targetMemberName: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamShutdownRequestArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (participant?.role !== "lead") throw new Error("team_shutdown_request is lead-only")
      await deps.requestShutdownOfMember(args.teamRunId, args.targetMemberName, participant.memberName, config)
      return JSON.stringify({ teamRunId: args.teamRunId, targetMemberName: args.targetMemberName, requesterName: participant.memberName, status: "shutdown_requested" })
    },
  })
}

export function createTeamApproveShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Approve a pending shutdown request.",
    args: { teamRunId: tool.schema.string(), memberName: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamApproveShutdownArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (!participant || (participant.role !== "lead" && participant.memberName !== args.memberName)) throw new Error("team_approve_shutdown: caller must be target member or team lead")
      await deps.approveShutdown(args.teamRunId, args.memberName, participant.memberName, config)
      return JSON.stringify({ teamRunId: args.teamRunId, memberName: args.memberName, approverName: participant.memberName, status: "shutdown_approved" })
    },
  })
}

export function createTeamRejectShutdownTool(config: TeamModeConfig, client: OpencodeClient, deps: TeamShutdownToolDeps = defaultTeamShutdownToolDeps): ToolDefinition {
  void client

  return tool({
    description: "Reject a pending shutdown request.",
    args: { teamRunId: tool.schema.string(), memberName: tool.schema.string(), reason: tool.schema.string() },
    async execute(rawArgs, toolContext) {
      const args = TeamRejectShutdownArgsSchema.parse(rawArgs)
      const runtimeContext = toolContext as TeamLifecycleToolContext
      const { participant } = await resolveParticipant(args.teamRunId, runtimeContext.sessionID, config, deps)
      if (!participant || (participant.role !== "lead" && participant.memberName !== args.memberName)) throw new Error("team_reject_shutdown: caller must be target member or team lead")
      await deps.rejectShutdown(args.teamRunId, args.memberName, participant.memberName, args.reason, config)
      return JSON.stringify({ teamRunId: args.teamRunId, memberName: args.memberName, rejectedBy: participant.memberName, reason: args.reason, status: "shutdown_rejected" })
    },
  })
}
