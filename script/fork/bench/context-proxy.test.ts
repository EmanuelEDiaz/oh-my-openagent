import { describe, expect, test } from "bun:test"

import { analyseRequest, renderContextTable, summarizeContext, systemSections, toolSource } from "./context-proxy"

describe("context recorder (fork 0.13)", () => {
  test("weighs system prompt sections, tools and history of a chat request", () => {
    const body = JSON.stringify({
      model: "big-pickle",
      messages: [
        { role: "system", content: `You are Sisyphus.\n<omo-test-integrity>\n${"rule ".repeat(200)}\n</omo-test-integrity>\n# Instructions from: base/01.md\n${"x".repeat(4000)}` },
        { role: "user", content: "hola" },
      ],
      tools: [{ type: "function", function: { name: "read", description: "r".repeat(400) } }, { type: "function", function: { name: "bash" } }],
    })
    const record = analyseRequest(body, "ses_1")
    expect(record.session).toBe("ses_1")
    expect(record.toolCount).toBe(2)
    expect(record.tools[0]?.name).toBe("read")
    expect(record.sections[0]?.title).toContain("Instructions from: base/01.md")
    expect(record.historyTokens).toBe(1)
  })

  test("reads Anthropic and Responses shapes too", () => {
    expect(analyseRequest(JSON.stringify({ system: "abcd".repeat(100), messages: [], tools: [{ name: "edit" }] })).systemTokens).toBe(100)
    expect(analyseRequest(JSON.stringify({ instructions: "abcd".repeat(50), input: "hi" })).systemTokens).toBe(50)
    expect(systemSections("<a>\nx\n<b>\nyyyy")[0]?.title).toBe("<b>")
  })

  test("subagent requests are reported apart from the orchestrator's", async () => {
    const { summarizeContext } = await import("./context-proxy")
    const base = { totalTokens: 10, systemTokens: 1, toolsTokens: 1, toolCount: 1, historyTokens: 1, sections: [], tools: [], toolSources: [] }
    const rows = summarizeContext([{ ...base, at: 5, subagent: true }, { ...base, at: 6, totalTokens: 30 }], [{ taskId: "t", repeat: 0, start: 0, end: 10 }])
    expect(rows.map((row) => row.taskId).sort()).toEqual(["t (orchestrator)", "t (subagent)"])
  })

  test("records every tool, not only the heaviest eight, grouped by source (incidents 07-10-2026)", () => {
    const names = ["bash", "read", "edit", "task", "skill", "session_list", "background_output", "lsp_diagnostics", "context7_query-docs", "context7_resolve-library-id", "grep_app_searchGitHub", "chrome-devtools_take_screenshot", "my-server_do", "ctx_execute"]
    const record = analyseRequest(JSON.stringify({ messages: [], tools: names.map((name) => ({ type: "function", function: { name, description: "d".repeat(40) } })) }), undefined, false, ["context7", "grep_app", "chrome-devtools", "my-server"])
    expect(record.tools).toHaveLength(names.length)
    expect(record.tools.map((tool) => tool.name).sort()).toEqual([...names].sort())
    const sources = Object.fromEntries(record.toolSources.map((source) => [source.source, source.count]))
    expect(sources).toEqual({ builtin: 5, plugin: 3, "mcp:context7": 2, "mcp:grep_app": 1, "mcp:chrome-devtools": 1, "mcp:my-server": 1, ctx: 1 })
    expect(record.toolSources.reduce((sum, source) => sum + source.tokens, 0)).toBe(record.tools.reduce((sum, tool) => sum + tool.tokens, 0))
  })

  test("classifies tool sources by name", () => {
    expect(toolSource("bash")).toBe("builtin")
    expect(toolSource("ctx_search")).toBe("ctx")
    expect(toolSource("websearch_web_search_exa")).toBe("mcp:websearch")
    expect(toolSource("websearch")).toBe("builtin")
    expect(toolSource("decision_record")).toBe("plugin")
  })

  test("splits system sections on ## headings and uppercase tags too", () => {
    const system = `intro\n## Project map\n${"p".repeat(400)}\n<Role>\n${"r".repeat(200)}\n<TOOL_USAGE>\n${"t".repeat(100)}\n# Rules\n${"x".repeat(40)}`
    const titles = systemSections(system).map((section) => section.title)
    expect(titles).toEqual(["## Project map", "<Role>", "<TOOL_USAGE>", "# Rules", "intro"])
  })

  test("the task table shows mean tool weight per source", () => {
    const base = { totalTokens: 10, systemTokens: 1, toolsTokens: 1, toolCount: 1, historyTokens: 1, sections: [], tools: [] }
    const rows = summarizeContext([
      { ...base, at: 1, toolSources: [{ source: "mcp:context7", count: 2, tokens: 100 }, { source: "builtin", count: 4, tokens: 40 }] },
      { ...base, at: 2, toolSources: [{ source: "builtin", count: 4, tokens: 60 }] },
    ], [{ taskId: "t", repeat: 0, start: 0, end: 10 }])
    expect(rows[0]?.toolSources).toEqual([{ source: "mcp:context7", count: 1, tokens: 50 }, { source: "builtin", count: 4, tokens: 50 }])
    expect(renderContextTable(rows)).toContain("mcp:context7 50 (1); builtin 50 (4)")
  })
})
