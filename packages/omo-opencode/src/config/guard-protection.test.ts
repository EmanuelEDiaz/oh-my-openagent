/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { protectGuards } from "./guard-protection"
import type { OhMyOpenCodeConfig } from "./schema"

describe("guards switched off only from the user config", () => {
  test("a project config that disables the tab agent roles (0.22) is ignored and reported", () => {
    const merged = { tab_agent_roles: { enabled: false } } as unknown as OhMyOpenCodeConfig
    const { config, ignored } = protectGuards(merged, {})
    expect(config.tab_agent_roles).toBeUndefined()
    expect(ignored).toContain("tab_agent_roles")
  })

  test("the user can switch the tab agent roles off", () => {
    const user = { tab_agent_roles: { enabled: false } } as Partial<OhMyOpenCodeConfig>
    const { config, ignored } = protectGuards(user as OhMyOpenCodeConfig, user)
    expect(config.tab_agent_roles?.enabled).toBe(false)
    expect(ignored).toEqual([])
  })

  // Fork roadmap 0.28: the permission for a team lead to merge into the user's branch is the user's alone.
  test("a project config cannot grant the team lead's merge permission", () => {
    const merged = { team_mode: { enabled: true, lead_merges_to_branch: true } } as unknown as OhMyOpenCodeConfig
    const { config, ignored } = protectGuards(merged, { team_mode: { enabled: true } } as Partial<OhMyOpenCodeConfig>)
    expect(config.team_mode?.lead_merges_to_branch).toBeUndefined()
    expect(config.team_mode?.enabled).toBe(true)
    expect(ignored).toContain("team_mode.lead_merges_to_branch")
  })

  test("the user's own permission is kept", () => {
    const user = { team_mode: { enabled: true, lead_merges_to_branch: true } } as unknown as Partial<OhMyOpenCodeConfig>
    const { config, ignored } = protectGuards(user as OhMyOpenCodeConfig, user)
    expect(config.team_mode?.lead_merges_to_branch).toBe(true)
    expect(ignored).toEqual([])
  })
})
