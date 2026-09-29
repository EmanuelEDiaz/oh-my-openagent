/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { TeamModeConfigSchema } from "../config/schema/team-mode"
import type { TeamModeConfig } from "../config/schema/team-mode"
import { saveRuntimeState } from "../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../features/team-mode/types"
import { runTeamDelete, runTeamList } from "./team-admin"

const TEAM_ID = "11111111-1111-4111-8111-111111111111"

function runtimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    version: 1,
    teamRunId: TEAM_ID,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "ses_Lead0001",
    members: [
      { name: "lead", sessionId: "ses_Lead0001", agentType: "leader", status: "running", pendingInjectedMessageIds: [] },
      { name: "m1", sessionId: "ses_Member001", agentType: "general-purpose", status: "running", worktreePath: "/work/m1", pendingInjectedMessageIds: [] },
    ],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10_000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
    ...overrides,
  }
}

describe("team admin CLI", () => {
  let baseDir: string
  let config: TeamModeConfig
  let lines: string[]
  const output = (line: string) => { lines.push(line) }

  async function seed(state: RuntimeState): Promise<void> {
    mkdirSync(join(baseDir, "runtime", state.teamRunId), { recursive: true })
    await saveRuntimeState(state, config)
  }

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "omo-team-admin-"))
    config = TeamModeConfigSchema.parse({ enabled: true, base_dir: baseDir })
    lines = []
  })

  afterEach(() => rmSync(baseDir, { recursive: true, force: true }))

  test("team list shows status, the lead session and whether it still exists, members and worktrees", async () => {
    // given
    await seed(runtimeState())

    // when
    const code = await runTeamList({ config, output, leadSessionExists: (id) => id === "ses_Lead0001" ? true : undefined })

    // then
    expect(code).toBe(0)
    const text = lines.join("\n")
    expect(text).toContain(`${TEAM_ID}  team-alpha  active`)
    expect(text).toContain("lead ses_Lead0001 (session exists)")
    expect(text).toContain("members: lead running, m1 running")
    expect(text).toContain("worktrees: /work/m1")
  })

  test("team list says so when there are no teams", async () => {
    // when
    const code = await runTeamList({ config, output, leadSessionExists: () => undefined })

    // then
    expect(code).toBe(0)
    expect(lines).toEqual(["No team runs found."])
  })

  test("team delete --dry-run describes what would be removed without touching anything", async () => {
    // given
    await seed(runtimeState())

    // when
    const code = await runTeamDelete(TEAM_ID, { config, output, dryRun: true })

    // then
    expect(code).toBe(0)
    expect(lines.join("\n")).toContain("Dry run: nothing was changed.")
    expect(lines.join("\n")).toContain("worktrees: /work/m1")
    expect(existsSync(join(baseDir, "runtime", TEAM_ID))).toBe(true)
  })

  test("team delete without --force refuses a team with active members and suggests --force", async () => {
    // given
    await seed(runtimeState())

    // when
    const code = await runTeamDelete(TEAM_ID, { config, output })

    // then
    expect(code).toBe(1)
    expect(lines.join("\n")).toContain("--force")
    expect(existsSync(join(baseDir, "runtime", TEAM_ID))).toBe(true)
  })

  test("team delete --force removes the team state from another process", async () => {
    // given
    await seed(runtimeState())

    // when
    const code = await runTeamDelete(TEAM_ID, { config, output, force: true })

    // then
    expect(code).toBe(0)
    expect(lines.join("\n")).toContain(`Deleted team team-alpha (${TEAM_ID}).`)
    expect(existsSync(join(baseDir, "runtime", TEAM_ID))).toBe(false)
  })

  test("team delete lists worktrees kept because they were not confirmed clean", async () => {
    // given
    await seed(runtimeState())
    const deleteTeamStub = async () => ({ removedWorktrees: ["/work/m2"], preservedWorktrees: [{ path: "/work/m1", reason: "uncommitted changes" }], removedLayout: false })

    // when
    const code = await runTeamDelete(TEAM_ID, { config, output, force: true, deleteTeam: deleteTeamStub })

    // then
    expect(code).toBe(0)
    expect(lines).toContain("Removed worktrees: /work/m2")
    expect(lines).toContain("Kept worktree /work/m1: uncommitted changes")
  })

  test("team delete reports an unknown team id", async () => {
    // when
    const code = await runTeamDelete("22222222-2222-4222-8222-222222222222", { config, output })

    // then
    expect(code).toBe(1)
    expect(lines.join("\n")).toContain("No team run 22222222-2222-4222-8222-222222222222")
  })
})
