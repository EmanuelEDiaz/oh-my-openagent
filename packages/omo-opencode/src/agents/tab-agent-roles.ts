import { getAgentConfigKey } from "../shared/agent-display-names"

/**
 * Fixed specialist sets per tab agent (fork roadmap 0.22, approved by the user 11-10-2026). Tab agents had too much
 * freedom: any of them could call any specialist. Each one now delegates only inside its role; a request outside it
 * is refused by code, with the tab agent the user should switch to. The user's own subagents (roadmap 2.2, D4) are
 * outside these sets and stay available to every orchestrator. `sisyphus-junior` stands for every `category` task.
 */
export const TAB_AGENT_SPECIALISTS: Readonly<Record<string, readonly string[]>> = {
  sisyphus: [
    "explore", "librarian", "api-lookup", "web-researcher", "memory", "debugger", "test-writer", "verifier",
    "dependency-check", "oracle", "sisyphus-junior",
  ],
  hephaestus: ["explore", "librarian", "api-lookup", "debugger", "test-writer", "verifier", "lang-reviewer", "sisyphus-junior"],
  prometheus: ["explore", "librarian", "web-researcher", "api-lookup", "memory", "metis", "momus", "oracle", "architect-reviewer"],
  atlas: [
    "explore", "sisyphus-junior", "test-writer", "debugger", "verifier", "ui-tester", "security-reviewer", "test-reviewer",
    "lang-reviewer", "architect-reviewer", "docs-writer", "git-committer",
  ],
}

const TAB_AGENT_LABELS: Readonly<Record<string, string>> = {
  sisyphus: "Sisyphus",
  hephaestus: "Hephaestus",
  prometheus: "Prometheus",
  atlas: "Atlas",
}

/** Every specialist that belongs to some tab agent's set: the plugin's roster. */
const ROSTER = new Set(Object.values(TAB_AGENT_SPECIALISTS).flat())

export function isTabAgent(agent: string | undefined): boolean {
  return agent !== undefined && getAgentConfigKey(agent) in TAB_AGENT_SPECIALISTS
}

/** Whether a tab agent may list (and call) this specialist; agents outside the roster are the user's own and allowed. */
export function isAllowedForTabAgent(tabAgent: string, target: string): boolean {
  const allowed = TAB_AGENT_SPECIALISTS[getAgentConfigKey(tabAgent)]
  const key = getAgentConfigKey(target)
  return allowed === undefined || !ROSTER.has(key) || allowed.includes(key)
}

/**
 * Undefined when the delegation is allowed; otherwise the refusal the calling agent receives, naming the tab agents
 * that own the specialist so the agent can tell the user which one to switch to.
 */
export function tabAgentDelegationError(parentAgent: string | undefined, target: string): string | undefined {
  if (!parentAgent || !isTabAgent(parentAgent) || isAllowedForTabAgent(parentAgent, target)) return undefined
  const parent = getAgentConfigKey(parentAgent)
  const key = getAgentConfigKey(target)
  const owners = Object.keys(TAB_AGENT_SPECIALISTS).filter((agent) => TAB_AGENT_SPECIALISTS[agent]?.includes(key)).map((agent) => TAB_AGENT_LABELS[agent] ?? agent)
  const what = key === "sisyphus-junior" ? "category tasks (sisyphus-junior)" : `"${key}"`
  const allowed = (TAB_AGENT_SPECIALISTS[parent] ?? []).map((agent) => (agent === "sisyphus-junior" ? "category tasks" : agent)).join(", ")
  return `${TAB_AGENT_LABELS[parent] ?? parent} cannot delegate to ${what}: it is outside this agent's role (fork roadmap 0.22). `
    + `Your specialists: ${allowed}. `
    + `If this step really needs ${what}, stop and tell the user to switch to ${owners.join(" or ")} (Tab) for it; do not work around this refusal.`
}

const COMMITTER = "git-committer"
// A commit-writing git subcommand as a command of its own (after env assignments and `-C`/`-c` options), not inside `echo`.
// Every git command that writes commits to the branch or publishes it (fork incident H56: `git merge` slipped past
// `commit|push` when Sisyphus joined Team Mode members' branches). `(?![\w-])` keeps `git merge-base` allowed.
const GIT_WRITE = /^(\w+=\S*\s+)*git\s+(-C\s+\S+\s+|-c\s+\S+\s+)*(commit|push|merge|rebase|cherry-pick|revert|am|pull)(?![\w-])/
// Stopping an operation already in progress writes nothing.
const GIT_STOP = /\s--(abort|quit)\b/

/**
 * Undefined when the agent may run this shell command; otherwise the refusal for a tab agent whose set has no
 * git-committer and writes or publishes commits itself (`git commit`, `git merge`, `git push`...) (measured 31-10-2026: Sisyphus never delegated the commit, it
 * committed with bash). Only tab agents are checked: their subagents keep their own rules.
 */
export function tabAgentGitError(agent: string | undefined, command: string): string | undefined {
  if (!agent || !isTabAgent(agent) || isAllowedForTabAgent(agent, COMMITTER)) return undefined
  const parts = command.split(/&&|\|\||;|\n/).map((part) => part.trim())
  if (!parts.some((part) => GIT_WRITE.test(part) && !GIT_STOP.test(part))) return undefined
  const label = TAB_AGENT_LABELS[getAgentConfigKey(agent)] ?? agent
  return `${label} cannot run git commands that write or publish commits (commit, merge, rebase, cherry-pick, revert, am, pull, push): commits belong to Atlas (git-committer), outside this agent's role (fork roadmap 0.22). `
    + "Finish your own part of the request, then stop and tell the user to switch to Atlas (Tab) for the commit; do not work around this refusal."
}

/** True for a tab agent whose fixed set has no git-committer (Sisyphus, Hephaestus, Prometheus): Atlas commits for it. */
export function tabAgentLacksCommitter(agent: string | undefined): boolean {
  return Boolean(agent) && isTabAgent(agent) && !isAllowedForTabAgent(agent as string, COMMITTER)
}

const GIT_PREFIX = String.raw`^(\w+=\S*\s+)*git\s+(-C\s+\S+\s+|-c\s+\S+\s+)*`
const GIT_MERGE = new RegExp(`${GIT_PREFIX}merge(?![\\w-])`)
const GIT_COMMIT = new RegExp(`${GIT_PREFIX}commit(?![\\w-])`)
const GIT_PUBLISH = new RegExp(`${GIT_PREFIX}(push|pull)(?![\\w-])`)
const TEAM_BRANCH = /^team\//
// Options of `git merge` that take a value, so the value is not mistaken for a branch.
const MERGE_VALUE_OPTIONS = new Set(["-m", "--message", "-F", "--file", "-s", "--strategy", "-X", "--strategy-option"])

function writingParts(command: string): string[] {
  return command.split(/&&|\|\||;|\n/).map((part) => part.trim()).filter((part) => GIT_WRITE.test(part) && !GIT_STOP.test(part))
}

/** Branches a `git merge` command joins (quoted message values and options skipped). */
function mergedRefs(part: string): string[] {
  const words = part.replace(/(["'])(?:(?!\1).)*\1/g, "MSG").split(/\s+/)
  const refs: string[] = []
  for (let index = words.indexOf("merge") + 1; index > 0 && index < words.length; index++) {
    const word = words[index] ?? ""
    if (MERGE_VALUE_OPTIONS.has(word)) index++
    else if (!word.startsWith("-")) refs.push(word)
  }
  return refs
}

/**
 * Undefined when a team lead without git-committer may run this command; otherwise its refusal (user decision
 * 12-11-2026, fork roadmap 0.28). In its integration branch `team/<name>` the lead merges its members' branches and
 * commits conflict fixes; outside it, it may only merge a `team/` branch, and only with the user's one-time permission
 * (`team_mode.lead_merges_to_branch`). Push, pull, rebase and other commits stay with Atlas.
 */
export function teamLeadGitError(currentBranch: string | undefined, command: string, leadMergesToBranch: boolean): string | undefined {
  const onTeamBranch = TEAM_BRANCH.test(currentBranch ?? "")
  for (const part of writingParts(command)) {
    if (onTeamBranch && (GIT_MERGE.test(part) || GIT_COMMIT.test(part))) continue
    const refs = GIT_MERGE.test(part) ? mergedRefs(part) : []
    if (!onTeamBranch && refs.length > 0 && refs.every((ref) => TEAM_BRANCH.test(ref))) {
      if (leadMergesToBranch) continue
      return "Joining a team/ branch into the user's branch needs the user's permission (fork roadmap 0.28). Tell the user the team branch is ready and verified: they can merge it, ask Atlas (Tab), "
        + "or allow you once and for all by typing /omo-team-merge on. Do not work around this refusal."
    }
    return "As team lead you join your members' branches only in an integration branch named team/<team name>: create it (git switch -c team/<name>), merge each member branch there and run the tests; "
      + "push, pull, rebase and other commits stay with Atlas (Tab) (fork roadmap 0.28). Do not work around this refusal."
  }
  return undefined
}

/**
 * Undefined when a member of a team led by a tab agent without git-committer may run this command; otherwise its
 * refusal. Members commit on their own branch in their own git worktree, never in the project's main folder (the
 * user's branch), and never publish (fork roadmap 0.28).
 */
export function teamMemberGitError(leadAgent: string | undefined, command: string, inLinkedWorktree: boolean): string | undefined {
  if (!tabAgentLacksCommitter(leadAgent)) return undefined
  const parts = writingParts(command)
  if (parts.length === 0) return undefined
  if (parts.some((part) => GIT_PUBLISH.test(part))) return "Team members never push or pull; report back to the team lead (fork roadmap 0.28)."
  if (inLinkedWorktree) return undefined
  return "Team members commit only in their own git worktree on their own branch (git worktree add ../<name> -b <branch>), never in the project's main folder (fork roadmap 0.28). "
    + "Move your work to your worktree, commit there and report the branch to the team lead."
}
