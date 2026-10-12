/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { isAllowedForTabAgent, TAB_AGENT_SPECIALISTS, tabAgentDelegationError } from "./tab-agent-roles"

describe("fixed specialist sets per tab agent (roadmap 0.22)", () => {
  test("a specialist inside the agent's set is allowed, by config key or display name", () => {
    expect(tabAgentDelegationError("sisyphus", "explore")).toBeUndefined()
    expect(tabAgentDelegationError("Sisyphus - ultraworker", "web-researcher")).toBeUndefined()
    expect(tabAgentDelegationError("Atlas - Plan Executor", "git-committer")).toBeUndefined()
    expect(tabAgentDelegationError("Prometheus - Plan Builder", "metis")).toBeUndefined()
  })

  test("a specialist outside the set is refused and names the agent to switch to", () => {
    const error = tabAgentDelegationError("Prometheus - Plan Builder", "git-committer")
    expect(error).toContain("Prometheus cannot delegate to \"git-committer\"")
    expect(error).toContain("switch to Atlas (Tab)")
  })

  test("a specialist owned by several agents lists all of them", () => {
    expect(tabAgentDelegationError("hephaestus", "web-researcher")).toContain("switch to Sisyphus or Prometheus (Tab)")
  })

  test("Prometheus cannot run category tasks (it plans, it does not implement)", () => {
    const error = tabAgentDelegationError("prometheus", "sisyphus-junior")
    expect(error).toContain("category tasks (sisyphus-junior)")
    expect(error).toContain("Sisyphus or Hephaestus or Atlas")
  })

  test("the user's own subagents stay available to every tab agent", () => {
    expect(tabAgentDelegationError("prometheus", "my-company-reviewer")).toBeUndefined()
    expect(isAllowedForTabAgent("atlas", "my-company-reviewer")).toBe(true)
  })

  test("agents that are not tab agents are not restricted here", () => {
    expect(tabAgentDelegationError("sisyphus-junior", "git-committer")).toBeUndefined()
    expect(tabAgentDelegationError(undefined, "git-committer")).toBeUndefined()
  })

  test("every specialist belongs to at least one tab agent and each set is the approved size", () => {
    expect(Object.fromEntries(Object.entries(TAB_AGENT_SPECIALISTS).map(([agent, set]) => [agent, set.length]))).toEqual({
      sisyphus: 11,
      hephaestus: 8,
      prometheus: 9,
      atlas: 12,
    })
  })
})
