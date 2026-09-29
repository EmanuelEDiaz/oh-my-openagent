import { TeamModeConfigSchema } from "../config/schema/team-mode"
import type { TeamModeConfig } from "../config/schema/team-mode"
import { validatePluginConfig } from "../config/validate"
import { opencodeDbPath } from "../features/knowledge/service"
import { openSessionReader } from "../features/knowledge/session-reader"
import { deleteTeam } from "../features/team-mode/team-runtime/delete-team"
import { listActiveTeams, loadRuntimeState } from "../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../features/team-mode/types"

type TeamAdminBase = {
  readonly config?: TeamModeConfig
  readonly output?: (line: string) => void
}

export type TeamListOptions = TeamAdminBase & {
  /** true/false when the lead session is (not) in opencode.db, undefined when that cannot be checked. */
  readonly leadSessionExists?: (sessionId: string) => boolean | undefined
}

export type TeamDeleteOptions = TeamListOptions & {
  readonly force?: boolean
  readonly dryRun?: boolean
  readonly deleteTeam?: typeof deleteTeam
}

function teamModeConfig(options: TeamAdminBase): TeamModeConfig {
  return options.config ?? TeamModeConfigSchema.parse(validatePluginConfig(process.cwd()).config.team_mode ?? {})
}

async function openDbLeadCheck(): Promise<{ check: (sessionId: string) => boolean | undefined; close: () => void }> {
  const reader = await openSessionReader(opencodeDbPath())
  if (reader === null) return { check: () => undefined, close: () => {} }
  return { check: (sessionId) => reader.session(sessionId) !== undefined, close: () => reader.close() }
}

function describeTeam(state: RuntimeState, leadExists: boolean | undefined): string[] {
  const lead = state.leadSessionId
    ? `lead ${state.leadSessionId} (${leadExists === undefined ? "session unknown" : leadExists ? "session exists" : "session missing"})`
    : "no lead session recorded"
  const worktrees = state.members.map((member) => member.worktreePath).filter((path): path is string => typeof path === "string")
  return [
    `${state.teamRunId}  ${state.teamName}  ${state.status}  ${lead}`,
    `  members: ${state.members.map((member) => `${member.name} ${member.status}`).join(", ") || "none"}`,
    `  worktrees: ${worktrees.join(", ") || "none"}`,
  ]
}

async function leadCheck(options: TeamListOptions): Promise<{ check: (sessionId: string) => boolean | undefined; close: () => void }> {
  return options.leadSessionExists ? { check: options.leadSessionExists, close: () => {} } : openDbLeadCheck()
}

/** `team list`: every team run still on disk, so runs left behind by another process can be found. */
export async function runTeamList(options: TeamListOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const config = teamModeConfig(options)
  const db = await leadCheck(options)
  try {
    const teams = await listActiveTeams(config)
    if (teams.length === 0) {
      output("No team runs found.")
      return 0
    }
    for (const team of teams) {
      const state = await loadRuntimeState(team.teamRunId, config).catch(() => undefined)
      if (!state) continue
      for (const line of describeTeam(state, state.leadSessionId ? db.check(state.leadSessionId) : undefined)) output(line)
    }
    return 0
  } finally {
    db.close()
  }
}

/**
 * `team delete`: removes a team run from outside the process that created it. Worktrees with uncommitted work are kept
 * (deleteTeam only removes worktrees git confirms as clean) and listed.
 */
export async function runTeamDelete(teamRunId: string, options: TeamDeleteOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const config = teamModeConfig(options)
  const state = await loadRuntimeState(teamRunId, config).catch(() => undefined)
  if (!state) {
    output(`No team run ${teamRunId}. Run \`oh-my-openagent team list\` to see the team runs on disk.`)
    return 1
  }
  const db = await leadCheck(options)
  try {
    for (const line of describeTeam(state, state.leadSessionId ? db.check(state.leadSessionId) : undefined)) output(line)
  } finally {
    db.close()
  }
  if (options.dryRun) {
    output("Dry run: nothing was changed.")
    return 0
  }
  if (options.force && (state.status === "active" || state.status === "shutdown_requested")) {
    output("Note: if the lead's OpenCode is still running, its members are not stopped from here.")
  }
  try {
    const result = await (options.deleteTeam ?? deleteTeam)(teamRunId, config, undefined, undefined, { force: options.force === true })
    output(`Deleted team ${state.teamName} (${teamRunId}).`)
    if (result.removedWorktrees.length > 0) output(`Removed worktrees: ${result.removedWorktrees.join(", ")}`)
    for (const kept of result.preservedWorktrees ?? []) {
      output(`Kept worktree ${kept.path}: ${kept.reason.replace(`preserving ${kept.path}: `, "")}`)
    }
    return 0
  } catch (error) {
    output(`Could not delete: ${error instanceof Error ? error.message : String(error)}`)
    if (!options.force) output("Re-run with --force to tear it down even while members are still active.")
    return 1
  }
}
