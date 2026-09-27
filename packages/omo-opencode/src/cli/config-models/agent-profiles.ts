export type AgentProfile = {
  /** A few words, shown next to the agent name in lists. */
  readonly summary: string
  /** What the agent does and what matters when picking its model. */
  readonly role: string
  readonly needsImageInput: boolean
  readonly weights: {
    readonly reasoning: number
    readonly context: number
    readonly cheap: number
    readonly recent: number
  }
}

const ORCHESTRATOR_WEIGHTS = { reasoning: 30, context: 25, cheap: 5, recent: 15 }
const PLANNER_WEIGHTS = { reasoning: 35, context: 20, cheap: 5, recent: 15 }
const SEARCHER_WEIGHTS = { reasoning: 5, context: 25, cheap: 35, recent: 10 }

const PROFILES: Readonly<Record<string, AgentProfile>> = {
  sisyphus: {
    summary: "main orchestrator",
    role: "Plans, delegates and edits code in long sessions. Best: strong reasoning + big context.",
    needsImageInput: false,
    weights: ORCHESTRATOR_WEIGHTS,
  },
  hephaestus: {
    summary: "autonomous deep worker",
    role: "Runs long unattended coding tasks. Best: top reasoning + big context.",
    needsImageInput: false,
    weights: ORCHESTRATOR_WEIGHTS,
  },
  atlas: {
    summary: "plan executor",
    role: "Executes a plan todo by todo and verifies each result. Best: strong reasoning + tools.",
    needsImageInput: false,
    weights: ORCHESTRATOR_WEIGHTS,
  },
  prometheus: {
    summary: "planner",
    role: "Interviews you and writes the work plan. Best: deep reasoning; cost matters less.",
    needsImageInput: false,
    weights: PLANNER_WEIGHTS,
  },
  metis: {
    summary: "pre-planning analyst",
    role: "Finds hidden requirements and risks before planning. Best: deep reasoning.",
    needsImageInput: false,
    weights: PLANNER_WEIGHTS,
  },
  momus: {
    summary: "plan reviewer",
    role: "Reviews plans for gaps and wrong references. Best: deep reasoning.",
    needsImageInput: false,
    weights: PLANNER_WEIGHTS,
  },
  oracle: {
    summary: "expert consultant",
    role: "Answers hard debugging/architecture questions. Best: the smartest model; cost matters little.",
    needsImageInput: false,
    weights: { reasoning: 45, context: 15, cheap: 0, recent: 15 },
  },
  librarian: {
    summary: "docs & web researcher",
    role: "Searches docs, the web and other repos, many times per task. Best: cheap + fast + tools.",
    needsImageInput: false,
    weights: SEARCHER_WEIGHTS,
  },
  explore: {
    summary: "codebase search",
    role: "Greps the codebase, often in parallel. Best: cheap + fast + big context.",
    needsImageInput: false,
    weights: SEARCHER_WEIGHTS,
  },
  "multimodal-looker": {
    summary: "reads images & PDFs",
    role: "Looks at screenshots, images and PDFs. MUST accept image input.",
    needsImageInput: true,
    weights: { reasoning: 10, context: 10, cheap: 25, recent: 15 },
  },
  "sisyphus-junior": {
    summary: "task executor",
    role: "Implements delegated todos with tools. Best: balance of quality and cost.",
    needsImageInput: false,
    weights: { reasoning: 20, context: 20, cheap: 20, recent: 15 },
  },
}

const DEFAULT_PROFILE: AgentProfile = {
  summary: "agent",
  role: "Custom agent.",
  needsImageInput: false,
  weights: { reasoning: 20, context: 20, cheap: 20, recent: 15 },
}

export function getAgentProfile(agent: string): AgentProfile {
  return PROFILES[agent] ?? DEFAULT_PROFILE
}
