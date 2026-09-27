export type AgentProfile = {
  readonly role: string
  readonly needsImageInput: boolean
  readonly weights: {
    readonly reasoning: number
    readonly context: number
    readonly cheap: number
    readonly recent: number
  }
}

const ORCHESTRATOR: AgentProfile = {
  role: "Main orchestrator: plans, delegates and edits code across long sessions. Favor strong reasoning and big context.",
  needsImageInput: false,
  weights: { reasoning: 30, context: 25, cheap: 5, recent: 15 },
}

const PLANNER: AgentProfile = {
  role: "Planning/review agent: reads a lot, reasons deeply, writes little. Favor reasoning over cost.",
  needsImageInput: false,
  weights: { reasoning: 35, context: 20, cheap: 5, recent: 15 },
}

const SEARCHER: AgentProfile = {
  role: "Fast search subagent, called many times in parallel. Favor cheap/fast models with tools and big context.",
  needsImageInput: false,
  weights: { reasoning: 5, context: 25, cheap: 35, recent: 10 },
}

const EXECUTOR: AgentProfile = {
  role: "Task executor: implements delegated todos with tools. Balance quality and cost.",
  needsImageInput: false,
  weights: { reasoning: 20, context: 20, cheap: 20, recent: 15 },
}

const PROFILES: Readonly<Record<string, AgentProfile>> = {
  sisyphus: ORCHESTRATOR,
  atlas: { ...ORCHESTRATOR, role: "Plan executor/orchestrator: drives a plan todo by todo and verifies results." },
  build: { ...EXECUTOR, role: "OpenCode's default build agent." },
  "OpenCode-Builder": { ...EXECUTOR, role: "OpenCode's builder agent." },
  plan: { ...PLANNER, role: "OpenCode's default read-only plan agent." },
  hephaestus: {
    ...ORCHESTRATOR,
    role: "Autonomous deep worker: long unattended coding runs. Favor top reasoning and big context.",
  },
  oracle: {
    role: "High-IQ consultant for hard debugging/architecture questions. Reasoning matters most; cost matters little.",
    needsImageInput: false,
    weights: { reasoning: 45, context: 15, cheap: 0, recent: 15 },
  },
  prometheus: { ...PLANNER, role: "Planner: interviews you and writes the work plan." },
  metis: { ...PLANNER, role: "Pre-planning analyst: finds hidden requirements and risks." },
  momus: { ...PLANNER, role: "Plan reviewer: checks plans for gaps and bad references." },
  librarian: { ...SEARCHER, role: "Docs/OSS researcher: searches the web, repos and docs. Favor cheap models with tools." },
  explore: SEARCHER,
  "multimodal-looker": {
    role: "Looks at images, PDFs and screenshots. REQUIRES image input.",
    needsImageInput: true,
    weights: { reasoning: 10, context: 10, cheap: 25, recent: 15 },
  },
  "sisyphus-junior": EXECUTOR,
}

export function getAgentProfile(agent: string): AgentProfile {
  return PROFILES[agent] ?? { ...EXECUTOR, role: "Custom agent." }
}
