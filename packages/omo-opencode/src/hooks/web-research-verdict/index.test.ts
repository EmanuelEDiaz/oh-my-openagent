import { describe, expect, test } from "bun:test"

import { createPluginWebResearch } from "../../features/web-research/plugin"
import { createWebResearchVerdictHook } from "./index"

describe("web-research verdict for the parent (fork 4.18)", () => {
  test("a researcher result without web_answer is flagged unverified; other tasks are untouched", async () => {
    const research = createPluginWebResearch(undefined, {})
    const hook = createWebResearchVerdictHook()
    const output = { output: "some answer", metadata: { sessionId: "ses_child1" } as Record<string, unknown> }
    await research.answer("ses_child2", { answer: "x", confidence: "not_found", claims: [] })
    await hook["tool.execute.after"]({ tool: "task", sessionID: "p", callID: "c", args: { subagent_type: "web-researcher" } }, output)
    expect(output.output).toContain("UNVERIFIED")

    const checked = { output: "ok", metadata: { sessionId: "ses_child2" } as Record<string, unknown> }
    await hook["tool.execute.after"]({ tool: "task", sessionID: "p", callID: "c", args: { subagent_type: "web-researcher" } }, checked)
    expect(checked.output).toContain("checked in code")

    const other = { output: "plain", metadata: { sessionId: "ses_x" } as Record<string, unknown> }
    await hook["tool.execute.after"]({ tool: "task", sessionID: "p", callID: "c", args: { subagent_type: "explore" } }, other)
    expect(other.output).toBe("plain")
  })
})
