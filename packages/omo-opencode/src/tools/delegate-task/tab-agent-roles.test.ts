/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createDelegateTask } from "./tools"

// Fork roadmap 0.22: each tab agent delegates only inside its approved specialist set, refused by code.
function tool(enforceTabAgentRoles: boolean | undefined) {
  const client = {
    app: { agents: async () => ({ data: [{ name: "git-committer", mode: "subagent" }, { name: "explore", mode: "subagent" }] }) },
    config: { get: async () => ({ data: { model: "opencode/big-pickle" } }) },
    session: {
      get: async () => ({ data: { directory: "/project" } }),
      create: async () => ({ data: { id: "s" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }
  return createDelegateTask({
    manager: { launch: async () => ({}) },
    client,
    directory: "/project",
    ...(enforceTabAgentRoles === undefined ? {} : { enforceTabAgentRoles }),
  } as unknown as Parameters<typeof createDelegateTask>[0])
}

const context = (agent: string) => ({ sessionID: "p", messageID: "m", agent, abort: new AbortController().signal })

describe("task refuses specialists outside the calling tab agent's role", () => {
  test("Prometheus asking for git-committer is refused with the agent to switch to", async () => {
    const result = await tool(true).execute(
      { description: "commit", prompt: "Commit the plan", subagent_type: "git-committer", run_in_background: false, load_skills: [] },
      context("Prometheus - Plan Builder") as never,
    )
    expect(result).toContain("Prometheus cannot delegate to \"git-committer\"")
    expect(result).toContain("switch to Atlas (Tab)")
  })

  test("Prometheus asking for a category task is refused", async () => {
    const result = await tool(true).execute(
      { description: "build", prompt: "Implement it", category: "quick", run_in_background: false, load_skills: [] },
      context("prometheus") as never,
    )
    expect(result).toContain("category tasks (sisyphus-junior)")
  })

  test("with the roles switched off the old behaviour stays (no refusal)", async () => {
    const result = await tool(false).execute(
      { description: "commit", prompt: "Commit the plan", subagent_type: "git-committer", run_in_background: true, load_skills: [] },
      context("prometheus") as never,
    )
    expect(String(result)).not.toContain("outside this agent's role")
  })
})
