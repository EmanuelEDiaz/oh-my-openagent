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
})
