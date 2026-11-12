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

// A new worktree, or a new branch by checkout/switch/branch (listing flags such as `--show-current` stay allowed).
const GIT_BRANCHING = /^(\w+=\S*\s+)*git\s+(-C\s+\S+\s+|-c\s+\S+\s+)*(worktree\s+add\b|checkout\s+(-[bB])\b|switch\s+(-[cC]|--create)\b|branch\s+(?!-)[\w./-]+)/

/**
 * Undefined when a team member may run this shell command; otherwise its refusal. In a team led by a tab agent without
 * git-committer, members share the project folder: no worktrees, branches or commits, so nothing reaches the user's
 * branch without Atlas (user decision 12-11-2026, fork roadmap 0.28; the lead cannot merge branches, H56).
 */
export function teamMemberGitError(leadAgent: string | undefined, command: string): string | undefined {
  if (!tabAgentLacksCommitter(leadAgent)) return undefined
  const parts = command.split(/&&|\|\||;|\n/).map((part) => part.trim())
  const blocked = parts.some((part) => GIT_BRANCHING.test(part) || (GIT_WRITE.test(part) && !GIT_STOP.test(part)))
  if (!blocked) return undefined
  const label = TAB_AGENT_LABELS[getAgentConfigKey(leadAgent as string)] ?? leadAgent
  return `Members of a team led by ${label} work in the shared folder on their own files: no git worktrees, new branches or commits (fork roadmap 0.28). `
    + "Leave your changes uncommitted and report back to the team lead; the commit is handed to Atlas (Tab). Do not work around this refusal."
}
