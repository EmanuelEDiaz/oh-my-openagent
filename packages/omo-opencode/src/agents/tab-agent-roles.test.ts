/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { isAllowedForTabAgent, TAB_AGENT_SPECIALISTS, tabAgentDelegationError, tabAgentGitError, teamLeadGitError, teamMemberGitError } from "./tab-agent-roles"

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

// Decided by the user on 31-10-2026: measured, Sisyphus never delegated the commit, it ran `git commit` itself; the
// commit belongs to Atlas (git-committer), so tab agents without it are refused in bash too.
describe("git commit and push stay with Atlas (roadmap 0.22)", () => {
  test.each([
    ["Sisyphus - ultraworker", 'git add src/math.ts && git commit -m "fix"'],
    ["sisyphus", "git commit -qam fix"],
    ["Hephaestus - Deep Agent", "git -C repo push origin main"],
    ["prometheus", "git status; git push"],
    ["sisyphus", "GIT_EDITOR=true git commit --amend"],
    // Fork incident H56: these write commits to the branch too; Team Mode QA saw Sisyphus join the members' branches.
    ["Sisyphus - ultraworker", "git merge --no-ff feat/roman -m merge"],
    ["sisyphus", "git rebase main"],
    ["sisyphus", "git cherry-pick abc123"],
    ["hephaestus", "git revert HEAD"],
    ["sisyphus", "git am 0001-fix.patch"],
    ["prometheus", "git pull origin main"],
  ])("%s is refused: %s", (agent, command) => {
    const error = tabAgentGitError(agent, command)
    expect(error).toContain("switch to Atlas (Tab)")
  })

  test.each([
    ["Atlas - Plan Executor", "git commit -m fix"],
    ["sisyphus", "git status && git diff && git log --oneline -3"],
    ["sisyphus", "echo git commit"],
    ["sisyphus", "git merge-base main HEAD"],
    ["sisyphus", "git merge --abort"],
    ["sisyphus", "git rebase --abort"],
    ["sisyphus", "git log --merges --oneline"],
    ["git-committer", "git commit -m fix"],
    ["sisyphus-junior", "git commit -m fix"],
    [undefined, "git commit -m fix"],
  ])("%s may run: %s", (agent, command) => {
    expect(tabAgentGitError(agent, command)).toBeUndefined()
  })
})

// Decided by the user on 12-11-2026 (fork roadmap 0.28, "rama de integración + permiso único"): members work on their
// own branches in worktrees; the lead joins them only in a team/<name> branch, and joins that branch into the user's
// only with the user's one-time permission (team_mode.lead_merges_to_branch).
describe("a Sisyphus team lead joins branches in team/<name> (roadmap 0.28)", () => {
  test.each([
    ["team/utils", "git merge --no-ff feat/roman -m join", false],
    ["team/utils", "git add src/roman.ts && git commit -m 'resolve conflict'", false],
    ["master", "git merge --no-ff team/utils -m done", true],
    ["master", "git status && git log --oneline -3", false],
  ])("on %s: allowed: %s (permission %s)", (branch, command, permission) => {
    expect(teamLeadGitError(branch, command, permission)).toBeUndefined()
  })

  test.each([
    ["master", "git merge feat/roman", false, "team/"],
    ["master", "git merge --no-ff team/utils", false, "/omo-team-merge"],
    ["master", "git merge feat/roman", true, "team/"],
    ["master", "git commit -m x", true, "team/"],
    ["team/utils", "git push origin team/utils", false, "team/"],
    ["team/utils", "git rebase master", false, "team/"],
  ])("on %s: refused: %s (permission %s)", (branch, command, permission, hint) => {
    expect(teamLeadGitError(branch, command, permission)).toContain(hint)
  })
})

describe("members of a Sisyphus team commit only in their own worktree (roadmap 0.28)", () => {
  test("a commit in the project's main folder is refused, in a linked worktree it is not", () => {
    expect(teamMemberGitError("sisyphus", "git commit -m wip", false)).toContain("worktree")
    expect(teamMemberGitError("sisyphus", "git commit -m wip", true)).toBeUndefined()
    expect(teamMemberGitError("sisyphus", "git worktree add ../wt -b feat/x && git status", false)).toBeUndefined()
    expect(teamMemberGitError("atlas", "git commit -m wip", false)).toBeUndefined()
  })
})
