import type { OhMyOpenCodeConfig } from "../config";
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names";
import { isTaskSystemEnabled } from "../shared";
import { WEB_RESEARCH_TOOLS } from "../tools/web-research/tools";
import { applyZenFreeGate } from "../features/zen-free-gate";
import { getAgentConfigKey } from "../shared/agent-display-names";

type AgentWithPermission = { permission?: Record<string, unknown> };

const TASK_DENIED_SUBAGENT_KEYS = [
  "librarian",
  "explore",
  "oracle",
  "multimodal-looker",
  "metis",
  "momus",
] as const;

/** Tools hidden from every agent unless an agent allows them below (librarian: grep_app_*; task-system agents: task_*). */
export const GLOBALLY_HIDDEN_TOOLS = [
  "grep_app_*",
  "LspHover",
  "LspCodeActions",
  "LspCodeActionResolve",
  "task_*",
  "teammate",
] as const;

/** The tab agents: they plan and delegate, so tools that only specialists call are hidden from them. */
export const TAB_ORCHESTRATOR_KEYS = ["sisyphus", "atlas", "prometheus", "hephaestus"] as const;

/**
 * MCP and context-mode tools the tab agents never call themselves (incidents of 07-10-2026). They stay available to every
 * other agent: librarian (context7, grep_app, websearch), api-lookup (context7), web-researcher (its own web tools),
 * and sisyphus-junior plus the category/specialist agents (chrome-devtools, supabase, pencil), so no capability is lost.
 */
export const ORCHESTRATOR_HIDDEN_MCP_TOOLS = [
  "chrome-devtools_*",
  "supabase_*",
  "pencil_*",
  "context7_*",
  "grep_app_*",
  "websearch_*",
  "ctx_*",
] as const;

/**
 * Tools the tab agents delegate instead of calling (switch: context_budget.orchestrator_minimal_tools, default true).
 * Deliberately kept: lsp_diagnostics (their prompts' evidence gate), interactive_bash (TUI QA), skill_mcp (playwright
 * skill), session_read (/handoff), process_* (the bash guard refuses long-running commands), monitor_* (primary
 * sessions only, so hiding it from tab agents would disable it).
 */
export const ORCHESTRATOR_DELEGATED_TOOLS = ["lsp_*", "ast_grep_*", "session_list", "session_info", "look_at"] as const;
const ORCHESTRATOR_DELEGATED_EXCEPTIONS = ["lsp_diagnostics"] as const;

/** Appends deny rules last (OpenCode applies the last matching rule) unless the agent's config sets that key itself. */
function hideToolsFromOrchestrator(agent: AgentWithPermission, minimalTools: boolean): void {
  const permission: Record<string, unknown> = { ...agent.permission };
  const explicit = new Set(Object.keys(permission));
  const denied = [...ORCHESTRATOR_HIDDEN_MCP_TOOLS, ...(minimalTools ? ORCHESTRATOR_DELEGATED_TOOLS : [])];
  for (const name of denied) {
    if (!explicit.has(name)) permission[name] = "deny";
  }
  if (minimalTools) {
    for (const name of ORCHESTRATOR_DELEGATED_EXCEPTIONS) {
      const value = permission[name] ?? "allow";
      delete permission[name];
      permission[name] = value;
    }
  }
  agent.permission = permission;
}

function getConfigQuestionPermission(): string | null {
  const configContent = process.env.OPENCODE_CONFIG_CONTENT;
  if (!configContent) return null;
  try {
    const parsed = JSON.parse(configContent);
    return parsed?.permission?.question ?? null;
  } catch (error) {
    if (error instanceof Error) return null;
    return null;
  }
}

function agentByKey(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig?: OhMyOpenCodeConfig,
): AgentWithPermission | undefined {
  return (agentResult[getAgentListDisplayName(key, pluginConfig?.agents)] ?? agentResult[getAgentDisplayName(key, pluginConfig?.agents)] ?? agentResult[key]) as
    | AgentWithPermission
    | undefined;
}

function denyTaskForAgent(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agent = agentByKey(agentResult, key, pluginConfig);
  if (!agent) return;
  agent.permission = { ...agent.permission, task: "deny" };
}

export function applyToolConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  agentResult: Record<string, unknown>;
}): void {
  const taskSystemEnabled = isTaskSystemEnabled(params.pluginConfig)
  const denyTodoTools = taskSystemEnabled
    ? { todowrite: "deny", todoread: "deny" }
    : {}

  const existingPermission = params.config.permission as Record<string, unknown> | undefined;
  // OpenCode turns config.tools into permissions before plugins run, so writing config.tools here has no effect
  // (incident 07-10-2026: grep_app_* still reached every request). Tools the plugin hides are denied in permission;
  // agents that need one allow it below. The user's own permission entries win over these defaults.
  const skillDeniedByHost = existingPermission?.skill === "deny";
  params.config.permission = {
    ...Object.fromEntries(GLOBALLY_HIDDEN_TOOLS.map((name) => [name, "deny"])),
    // Only web-researcher searches the web this way (fork roadmap 4.18); orchestrators delegate to it.
    ...Object.fromEntries(WEB_RESEARCH_TOOLS.map((name) => [name, "deny"])),
    ...denyTodoTools,
    ...(skillDeniedByHost ? { skill_mcp: "deny" } : {}),
    ...(existingPermission ?? {}),
  };

  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true";
  const configQuestionPermission = getConfigQuestionPermission();
  const isQuestionDisabledByPlugin = params.pluginConfig.disabled_tools?.includes("question") ?? false;
  const questionPermission =
    isQuestionDisabledByPlugin ? "deny" :
    configQuestionPermission === "deny" ? "deny" :
    isCliRunMode ? "deny" :
    "allow";

  for (const agentKey of TASK_DENIED_SUBAGENT_KEYS) {
    denyTaskForAgent(params.agentResult, agentKey, params.pluginConfig);
  }

  const librarian = agentByKey(params.agentResult, "librarian", params.pluginConfig);
  if (librarian) {
    librarian.permission = { ...librarian.permission, "grep_app_*": "allow" };
  }
  const webResearcher = agentByKey(params.agentResult, "web-researcher", params.pluginConfig);
  if (webResearcher) {
    webResearcher.permission = { ...webResearcher.permission, ...Object.fromEntries(WEB_RESEARCH_TOOLS.map((name) => [name, "allow"])) };
  }
  const looker = agentByKey(params.agentResult, "multimodal-looker", params.pluginConfig);
  if (looker) {
    looker.permission = { ...looker.permission, task: "deny", look_at: "deny" };
  }
  const atlas = agentByKey(params.agentResult, "atlas", params.pluginConfig);
  if (atlas) {
    atlas.permission = {
      task: "allow",
      ...atlas.permission,
      call_omo_agent: "deny",
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const sisyphus = agentByKey(params.agentResult, "sisyphus", params.pluginConfig);
  if (sisyphus) {
    sisyphus.permission = {
      task: "allow",
      ...sisyphus.permission,
      call_omo_agent: "deny",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const hephaestus = agentByKey(params.agentResult, "hephaestus", params.pluginConfig);
  if (hephaestus) {
    hephaestus.permission = {
      task: "allow",
      ...hephaestus.permission,
      call_omo_agent: "deny",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }
  const prometheus = agentByKey(params.agentResult, "prometheus", params.pluginConfig);
  if (prometheus) {
    prometheus.permission = {
      task: "allow",
      ...prometheus.permission,
      call_omo_agent: "deny",
      question: questionPermission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
      bash: "deny",
      interactive_bash: "deny",
      // Workspace-wide rewrites cannot be confined to .omo/*.md (fork roadmap 0.4); the hook blocks them too.
      lsp_rename: "deny",
      ast_grep_rewrite: "deny",
      // process_start would run commands that bash: "deny" refuses.
      "process_*": "deny",
    };
  }
  const junior = agentByKey(params.agentResult, "sisyphus-junior", params.pluginConfig);
  if (junior) {
    junior.permission = {
      ...junior.permission,
      "task_*": "allow",
      teammate: "allow",
      ...denyTodoTools,
    };
  }

  const minimalTools = params.pluginConfig.context_budget?.orchestrator_minimal_tools !== false;
  for (const key of TAB_ORCHESTRATOR_KEYS) {
    const agent = agentByKey(params.agentResult, key, params.pluginConfig);
    if (agent) hideToolsFromOrchestrator(agent, minimalTools);
  }

  params.config.permission = {
    webfetch: "allow",
    external_directory: "allow",
    ...(params.config.permission as Record<string, unknown>),
    task: "deny",
  };

  // Zen's free tier needs bash and read listed; agents that hide them get them listed but denied (see zen-free-gate).
  if (params.pluginConfig.zen_free_gate !== false) {
    for (const [name, agent] of Object.entries(params.agentResult)) {
      if (agent && typeof agent === "object") applyZenFreeGate(getAgentConfigKey(name), agent as { permission?: Record<string, unknown>; prompt?: string; model?: string });
    }
  }
}
