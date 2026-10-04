import { describe, expect, test } from "bun:test"

import { analyseRequest, systemSections } from "./context-proxy"

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
    expect(record.heaviestTools[0]?.name).toBe("read")
    expect(record.sections[0]?.title).toContain("Instructions from: base/01.md")
    expect(record.historyTokens).toBe(1)
  })

  test("reads Anthropic and Responses shapes too", () => {
    expect(analyseRequest(JSON.stringify({ system: "abcd".repeat(100), messages: [], tools: [{ name: "edit" }] })).systemTokens).toBe(100)
    expect(analyseRequest(JSON.stringify({ instructions: "abcd".repeat(50), input: "hi" })).systemTokens).toBe(50)
    expect(systemSections("<a>\nx\n<b>\nyyyy")[0]?.title).toBe("<b>")
  })
})
