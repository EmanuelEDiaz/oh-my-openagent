import { describe, expect, it } from "bun:test"

import type { OhMyOpenCodeConfig } from "../config"
import { hidesTool } from "../features/zen-free-gate"
import { applyToolConfig } from "./tool-config-handler"

type Permission = Record<string, unknown>

const TAB_AGENTS = ["sisyphus", "atlas", "prometheus", "hephaestus"]
const SPECIALISTS = ["librarian", "api-lookup", "web-researcher", "sisyphus-junior", "explore", "ui-tester"]
const MCP_AND_CTX_TOOLS = [
  "chrome-devtools_take_screenshot",
  "supabase_execute_sql",
  "pencil_batch_design",
  "context7_query-docs",
  "grep_app_searchGitHub",
  "websearch_web_search_exa",
  "ctx_execute",
]
const DELEGATED_TOOLS = ["lsp_goto_definition", "lsp_find_references", "ast_grep_search", "session_list", "session_info", "look_at"]
const KEPT_BY_ORCHESTRATORS = [
  "read",
  "glob",
  "grep",
  "edit",
  "write",
  "task",
  "skill",
  "question",
  "background_output",
  "knowledge_search",
  "session_search",
  "session_read",
  "lsp_diagnostics",
  "skill_mcp",
  "monitor_start",
]

function run(pluginConfig: Partial<OhMyOpenCodeConfig> = {}, globalPermission: Permission = {}) {
  const agentResult: Record<string, { permission?: Permission }> = {}
  for (const agent of [...TAB_AGENTS, ...SPECIALISTS]) agentResult[agent] = { permission: {} }
  const config: Record<string, unknown> = { tools: {}, permission: globalPermission }
  applyToolConfig({ config, pluginConfig: pluginConfig as OhMyOpenCodeConfig, agentResult })
  return { config, agentResult, global: config.permission as Permission }
}

/** OpenCode's rule: the agent's rules come after the global ones and the last matching rule decides. */
function hiddenFor(global: Permission, agent: Permission | undefined, tool: string): boolean {
  let hidden = false
  for (const rules of [global, agent ?? {}]) {
    for (const key of Object.keys(rules)) {
      const matches = hidesTool({ [key]: "deny" }, tool)
      if (matches) hidden = hidesTool({ [key]: rules[key] }, tool)
    }
  }
  return hidden
}

describe("context budget: plugin-hidden tools go through permission (incidents 07-10-2026)", () => {
  it("denies grep_app, the LSP code-action tools, task_* and teammate in permission instead of the no-op config.tools", () => {
    const { config, global } = run()
    for (const key of ["grep_app_*", "LspHover", "LspCodeActions", "LspCodeActionResolve", "task_*", "teammate"]) {
      expect(global[key]).toBe("deny")
    }
    expect(config.tools).toEqual({})
  })

  it("lets the user's own permission entries win over the plugin defaults", () => {
    const { global } = run({}, { "grep_app_*": "allow" })
    expect(global["grep_app_*"]).toBe("allow")
  })

  it("keeps grep_app for librarian and task_* for the tab agents", () => {
    const { global, agentResult } = run()
    expect(hiddenFor(global, agentResult["librarian"].permission, "grep_app_searchGitHub")).toBe(false)
    for (const agent of TAB_AGENTS) expect(agentResult[agent].permission?.["task_*"]).toBe("allow")
  })

  it("denies skill_mcp with skill when the host denies skill", () => {
    const { global } = run({}, { skill: "deny" })
    expect(global.skill).toBe("deny")
    expect(global.skill_mcp).toBe("deny")
  })
})

describe("context budget: tab orchestrators see no MCP, ctx_* or delegated tools", () => {
  it.each(TAB_AGENTS)("%s hides the MCP and context-mode tools", (agent) => {
    const { global, agentResult } = run()
    for (const tool of MCP_AND_CTX_TOOLS) expect(hiddenFor(global, agentResult[agent].permission, tool)).toBe(true)
  })

  it.each(TAB_AGENTS)("%s hides the tools it delegates but keeps the ones its prompt and commands need", (agent) => {
    const { global, agentResult } = run()
    const hidden = (tool: string) => hiddenFor(global, agentResult[agent].permission, tool)
    for (const tool of DELEGATED_TOOLS) expect(hidden(tool)).toBe(true)
    for (const tool of KEPT_BY_ORCHESTRATORS) expect(hidden(tool)).toBe(false)
  })

  it("keeps bash for Sisyphus, Atlas and Hephaestus (Zen free gate), and process_* only where bash is allowed", () => {
    const { global, agentResult } = run()
    for (const agent of ["sisyphus", "atlas", "hephaestus"]) {
      const hidden = (tool: string) => hiddenFor(global, agentResult[agent].permission, tool)
      expect(hidden("bash")).toBe(false)
      expect(hidden("process_start")).toBe(false)
    }
    expect(hiddenFor(global, agentResult["prometheus"].permission, "process_start")).toBe(true)
  })

  it("context_budget.orchestrator_minimal_tools: false keeps the delegated tools but still hides MCP tools", () => {
    const { global, agentResult } = run({ context_budget: { orchestrator_minimal_tools: false } } as Partial<OhMyOpenCodeConfig>)
    const hidden = (tool: string) => hiddenFor(global, agentResult["sisyphus"].permission, tool)
    for (const tool of DELEGATED_TOOLS) expect(hidden(tool)).toBe(false)
    expect(hidden("context7_query-docs")).toBe(true)
  })

  it("an explicit agent permission for a hidden tool wins", () => {
    const agentResult: Record<string, { permission?: Permission }> = { sisyphus: { permission: { "context7_*": "allow" } } }
    const config: Record<string, unknown> = { permission: {} }
    applyToolConfig({ config, pluginConfig: {} as OhMyOpenCodeConfig, agentResult })
    expect(hiddenFor(config.permission as Permission, agentResult["sisyphus"].permission, "context7_query-docs")).toBe(false)
  })

  it.each(SPECIALISTS)("%s keeps every MCP and context-mode tool it had", (agent) => {
    const { global, agentResult } = run()
    const permission = agentResult[agent].permission
    for (const tool of ["chrome-devtools_take_screenshot", "supabase_execute_sql", "pencil_batch_design", "context7_query-docs", "ctx_execute", "lsp_goto_definition", "look_at"]) {
      expect(hiddenFor(global, permission, tool)).toBe(false)
    }
  })
})
