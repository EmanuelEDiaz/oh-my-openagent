import { z } from "zod"
import { AnyMcpNameSchema } from "../../mcp/types"
import { AgentDefinitionsConfigSchema } from "./agent-definitions"
import { AgentOverridesSchema } from "./agent-overrides"
import { BabysittingConfigSchema } from "./babysitting"
import { BackgroundTaskConfigSchema } from "./background-task"
import { BrowserAutomationConfigSchema } from "./browser-automation"
import { CategoriesConfigSchema } from "./categories"
import { ClaudeCodeConfigSchema } from "./claude-code"
import { CommentCheckerConfigSchema } from "./comment-checker"
import { BuiltinCommandNameSchema } from "./commands"
import { DefaultModeConfigSchema } from "./default-mode"
import { ExperimentalConfigSchema } from "./experimental"
import { GitMasterConfigSchema } from "./git-master"
import { I18nConfigSchema } from "./i18n"
import { KeywordDetectorConfigSchema } from "./keyword-detector"
import { NotificationConfigSchema } from "./notification"
import { OpenClawConfigSchema } from "./openclaw"
import { ModelCapabilitiesConfigSchema } from "./model-capabilities"
import { GoalConfigSchema } from "./goal"
import { KnowledgeConfigSchema } from "./knowledge"
import { MonitorConfigSchema } from "./monitor"
import { StallConfigSchema } from "./stall"
import { ProcessesConfigSchema } from "./processes"
import { ResumeConfigSchema } from "./resume"
import { TestIntegrityConfigSchema } from "./test-integrity"
import { EditDiagnosticsConfigSchema } from "./edit-diagnostics"
import { WebResearchConfigSchema } from "./web-research"
import { LoopBreakerConfigSchema, RetryBudgetConfigSchema } from "./loop-breaker"
import { ResilienceConfigSchema } from "./resilience"
import { RuntimeFallbackConfigSchema } from "./runtime-fallback"
import { TeamModeConfigSchema } from "./team-mode"
import { SkillsConfigSchema } from "./skills"
import { SisyphusConfigSchema } from "./sisyphus"
import { SisyphusAgentConfigSchema } from "./sisyphus-agent"
import { TmuxConfigSchema } from "./tmux"
import { TuiConfigSchema } from "./tui"
import { UlwExecuteConfigSchema } from "./ulw-execute"
import { WebsearchConfigSchema } from "./websearch"

export const OhMyOpenCodeConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Enable new task system (default: false) */
  new_task_system_enabled: z.boolean().optional(),
  /** Default agent name for `oh-my-opencode run` (env: OPENCODE_DEFAULT_AGENT) */
  default_run_agent: z.string().optional(),
  /** Preferred display order for known agents. Invalid names are ignored with a toast warning. */
  agent_order: z.array(z.string().max(128)).max(64).optional(),
  /** Paths to external agent definition files (.md or .json) */
  agent_definitions: AgentDefinitionsConfigSchema,
  disabled_mcps: z.array(AnyMcpNameSchema).optional(),
  disabled_agents: z.array(z.string()).optional(),
  disabled_skills: z.array(z.string()).optional(),
  disabled_hooks: z.array(z.string()).optional(),
  disabled_commands: z.array(BuiltinCommandNameSchema).optional(),
  /** Disable specific tools by name (e.g., ["todowrite", "todoread"]) */
  disabled_tools: z.array(z.string()).optional(),
  /**
   * Provider prefixes to exclude from every agent/category fallback chain at
   * load time. Each entry matches the first slash-separated segment of a model
   * id (e.g., "github-copilot" matches "github-copilot/gpt-5.5"). If a primary
   * `model` references a disabled provider, it is replaced with the first
   * allowed entry from the same chain.
   */
  disabled_providers: z.array(z.string()).optional(),
  mcp_env_allowlist: z.array(z.string()).optional(),
  /** Enable hashline_edit tool/hook integrations (default: false) */
  hashline_edit: z.boolean().optional(),
  /** Enable anonymous telemetry. Default: enabled when omitted. Set to false to disable. */
  telemetry: z.boolean().optional().describe("Enable or disable anonymous telemetry. Default: enabled when omitted. Set to false to disable."),
  /** Enable model fallback on API errors (default: false). Set to true to enable automatic model switching when model errors occur. */
  model_fallback: z.boolean().optional(),
  agents: AgentOverridesSchema.optional(),
  categories: CategoriesConfigSchema.optional(),
  claude_code: ClaudeCodeConfigSchema.optional(),
  sisyphus_agent: SisyphusAgentConfigSchema.optional(),
  comment_checker: CommentCheckerConfigSchema.optional(),
  experimental: ExperimentalConfigSchema.optional(),
  auto_update: z.boolean().optional(),
  skills: SkillsConfigSchema.optional(),
  goal: GoalConfigSchema.optional(),
  knowledge: KnowledgeConfigSchema.optional(),
  /**
   * Prefer free models for automatic picks (fallback chains, builtin category defaults). Models chosen in /omo-models
   * or in agents/categories config always win, even when paid.
   */
  prefer_free_models: z.boolean().optional(),
  /** Deprecated compatibility shim. Old \`ralph_loop\` key is parsed and migrated to \`goal\` in validate.ts. */
  ralph_loop: z.record(z.string(), z.unknown()).optional(),
  /**
   * Enable runtime fallback (default: false)
   * Set to false to disable, or use object for advanced config:
   * { "enabled": true, "retry_on_errors": [429, 500, 502, 503, 504], "timeout_seconds": 30 }
   */
  runtime_fallback: z.union([z.boolean(), RuntimeFallbackConfigSchema]).optional(),
  background_task: BackgroundTaskConfigSchema.optional(),
  notification: NotificationConfigSchema.optional(),
  model_capabilities: ModelCapabilitiesConfigSchema.optional(),
  openclaw: OpenClawConfigSchema.optional(),
  /** Plugin i18n settings */
  i18n: I18nConfigSchema.optional(),
  monitor: MonitorConfigSchema.optional(),
  /** Silent model stalls: default chunk timeout and stall watchdog (fork roadmap 0.8) */
  stall: StallConfigSchema.optional(),
  /** Managed background processes; long-running commands must use process_start (fork roadmap 0.8b) */
  processes: ProcessesConfigSchema.optional(),
  /** Lossless resume: cards, SIGTERM save, memory watch, /omo-resume (fork roadmap 0.8c) */
  resume: ResumeConfigSchema.optional(),
  /** Read-only tests while fixing, refused cheating edits, new tests judged by fail-before/pass-after (fork roadmap 0.9a) */
  test_integrity: TestIntegrityConfigSchema.optional(),
  /** Only the errors an edit introduced, with alternatives; syntax-breaking edits undone (fork roadmap 0.9a) */
  edit_diagnostics: EditDiagnosticsConfigSchema.optional(),
  /** web-researcher: keyless open-web search with verified citations; optional free keys (fork roadmap 4.18) */
  web_research: WebResearchConfigSchema.optional(),
  /** Same error after repeated fixes: nudge, fresh debugger + research, then ask the user (fork roadmap 0.9b) */
  loop_breaker: LoopBreakerConfigSchema.optional(),
  resilience: ResilienceConfigSchema.optional(),
  /** One retry budget per task for stalls and loops; spent → paused and the user is told (fork roadmap 0.9b) */
  retry_budget: RetryBudgetConfigSchema.optional(),
  /** Keep bash/read listed (every use denied) for agents that hide them when their model is a free Zen model, whose free tier rejects requests without them (default: true) */
  zen_free_gate: z.boolean().optional(),
  team_mode: TeamModeConfigSchema.optional(),
  keyword_detector: KeywordDetectorConfigSchema.optional(),
  babysitting: BabysittingConfigSchema.optional(),
  git_master: GitMasterConfigSchema.default({
    commit_footer: false,
    include_co_authored_by: false,
    git_env_prefix: "GIT_MASTER=1",
  }),
  browser_automation_engine: BrowserAutomationConfigSchema.optional(),
  websearch: WebsearchConfigSchema.optional(),
  tmux: TmuxConfigSchema.optional(),
  tui: TuiConfigSchema.default({ sidebar: { enabled: true } }).optional(),
  sisyphus: SisyphusConfigSchema.optional(),
  ulw_execute: UlwExecuteConfigSchema.optional(),
  /** Deprecated compatibility shim. Old \`start_work\` key is parsed and migrated to \`ulw_execute\` in validate.ts. */
  start_work: UlwExecuteConfigSchema.optional(),
  /** Default mode auto-activation settings (ultrawork, goal) */
  default_mode: DefaultModeConfigSchema.optional(),
  /** Migration history to prevent re-applying migrations (e.g., model version upgrades) */
  _migrations: z.array(z.string()).optional(),
})

export type OhMyOpenCodeConfig = z.infer<typeof OhMyOpenCodeConfigSchema>
