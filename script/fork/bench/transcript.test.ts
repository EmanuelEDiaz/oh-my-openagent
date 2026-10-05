import { describe, expect, test } from "bun:test"

import { toTranscript } from "./transcript"

const assistant = (agent: string, extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  agent,
  providerID: "opencode",
  modelID: "big-pickle",
  cost: 0.5,
  tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 10, write: 1 } },
  time: { created: 1_000, completed: 4_000 },
  ...extra,
})

describe("toTranscript", () => {
  test("reads agent, model, final answer, tools, tokens and turns from the session messages", () => {
    const transcript = toTranscript(
      [
        { info: { role: "user", time: { created: 500 } }, parts: [{ type: "text", text: "find x" }] },
        {
          info: assistant("explore"),
          parts: [
            { type: "text", text: "looking" },
            { type: "tool", tool: "grep", state: { status: "completed", input: { pattern: "x" }, output: "..." } },
            { type: "tool", tool: "bash", state: { status: "error", input: { command: "rm" }, error: "denied" } },
          ],
        },
        { info: assistant("explore", { time: { created: 4_000, completed: 6_000 } }), parts: [{ type: "text", text: "<results>done</results>" }, { type: "text", text: "ignored", synthetic: true }] },
      ],
      ["oracle"],
    )

    expect(transcript.agent).toBe("explore")
    expect(transcript.model).toBe("opencode/big-pickle")
    expect(transcript.answer).toBe("<results>done</results>")
    expect(transcript.tools).toEqual([
      { tool: "grep", status: "completed", input: { pattern: "x" }, output: "..." },
      { tool: "bash", status: "error", input: { command: "rm" }, error: "denied" },
    ])
    expect(transcript.tokens).toEqual({ input: 200, output: 40, reasoning: 10, cacheRead: 20, cacheWrite: 2 })
    expect(transcript.cost).toBe(1)
    expect(transcript.turns).toBe(2)
    expect(transcript.durationMs).toBe(5_500)
    expect(transcript.delegatedAgents).toEqual(["oracle"])
    expect(transcript.error).toBeUndefined()
  })

  test("a provider error on an assistant message is surfaced", () => {
    const transcript = toTranscript([
      { info: { role: "user", time: { created: 0 } }, parts: [] },
      { info: assistant("explore", { error: { name: "APIError", data: { message: "403 free tier" } } }), parts: [] },
    ])
    expect(transcript.error).toContain("403 free tier")
  })

  test("an empty session has no agent and an error", () => {
    const transcript = toTranscript([])
    expect(transcript.agent).toBe("")
    expect(transcript.error).toContain("no assistant message")
  })
})
