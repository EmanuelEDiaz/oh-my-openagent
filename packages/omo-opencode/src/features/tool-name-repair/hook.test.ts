import { describe, expect, test } from "bun:test"

import { createToolNameRepair, endedAfterCall, MAX_CONSECUTIVE_CONTINUATIONS, type SessionMessage } from "./hook"
import { cleanToolName, parseUnavailableToolError, resolveToolName } from "./repair"

// The exact shape seen in the bench (2026-10-05 loops run, big-pickle).
const AVAILABLE = ["bash", "edit", "glob", "grep", "grep_app_searchGitHub", "invalid", "read", "write"]
const unavailable = (name: string, available = AVAILABLE): string =>
  `Model tried to call unavailable tool '${name}'. Available tools: ${available.join(", ")}.`

function invalidCall(name: string, callID = "call-1", available = AVAILABLE) {
  const error = unavailable(name, available)
  return {
    input: { tool: "invalid", sessionID: "ses", callID, args: { tool: name, error } },
    output: { title: "Invalid Tool", output: `The arguments provided to the tool are invalid: ${error}`, metadata: {} as Record<string, unknown> },
  }
}

const assistant = (id: string, parts: SessionMessage["parts"], error?: unknown): SessionMessage => ({ info: { id, role: "assistant", ...(error ? { error } : {}) }, parts })
const user = (id: string, text: string): SessionMessage => ({ info: { id, role: "user" }, parts: [{ type: "text", text }] })

function harness(messages: SessionMessage[] = []) {
  const sent: Array<{ sessionID: string; text: string }> = []
  const repair = createToolNameRepair({
    fetchMessages: async () => messages,
    continueSession: async (sessionID, text) => {
      sent.push({ sessionID, text })
    },
  })
  return { repair, sent, messages }
}

describe("tool name cleaning (fork 0.15 F)", () => {
  test("the AI SDK error text gives the called name and the available tools", () => {
    expect(parseUnavailableToolError(unavailable("bash\u0000"))).toEqual({ name: "bash\u0000", available: AVAILABLE })
    expect(parseUnavailableToolError("The arguments provided to the tool are invalid: expected string")).toBeUndefined()
  })

  test("NUL, spaces, zero-width characters, quotes and case are cleaned", () => {
    expect(cleanToolName("bash\u0000")).toBe("bash")
    expect(cleanToolName(" bash \n")).toBe("bash")
    expect(cleanToolName("ba​sh﻿")).toBe("bash")
    expect(cleanToolName("\"BASH\"")).toBe("bash")
  })

  test("a cleaned name matching exactly one available tool is repaired, case-insensitively", () => {
    expect(resolveToolName("bash\u0000", AVAILABLE)).toBe("bash")
    expect(resolveToolName("  read ", AVAILABLE)).toBe("read")
    expect(resolveToolName("WRITE", AVAILABLE)).toBe("write")
    expect(resolveToolName("re‍ad", AVAILABLE)).toBe("read")
    // OpenCode only lowercases, so a mixed-case tool never matches there.
    expect(resolveToolName("grep_app_searchgithub", AVAILABLE)).toBe("grep_app_searchGitHub")
  })

  test("unknown, ambiguous, empty and already-valid names are left as they are", () => {
    expect(resolveToolName("analysis", AVAILABLE)).toBeUndefined()
    expect(resolveToolName("Foo\u0000", ["foo", "FOO", "bash"])).toBeUndefined()
    expect(resolveToolName("\u0000 ", AVAILABLE)).toBeUndefined()
    expect(resolveToolName("bash", AVAILABLE)).toBeUndefined()
    expect(resolveToolName("INVALID", AVAILABLE)).toBeUndefined()
  })
})

describe("invalid tool result rewrite (fork 0.15 F)", () => {
  test("a NUL-suffixed name becomes a short retry instruction naming the real tool", async () => {
    // given
    const { repair } = harness()
    const { input, output } = invalidCall("bash\u0000")

    // when
    await repair["tool.execute.after"](input, output)

    // then
    expect(output.output).toBe(
      "[tool-name-repair] You called the tool 'bash\\u0000', which does not exist: the name has stray characters. " +
        "The tool is named 'bash'. Call 'bash' again now with the same arguments, then continue the task.",
    )
    expect(output.metadata).toEqual({ toolNameRepair: { from: "bash\u0000", to: "bash" } })
  })

  test("unknown and ambiguous names keep OpenCode's own message", async () => {
    const { repair } = harness()
    for (const [name, available] of [["analysis", AVAILABLE], ["Foo ", ["foo", "FOO"]]] as const) {
      const { input, output } = invalidCall(name, "call-x", [...available])
      const before = output.output
      await repair["tool.execute.after"](input, output)
      expect(output.output).toBe(before)
      expect(output.metadata).toEqual({})
    }
  })

  test("other tools and invalid-argument errors are not touched", async () => {
    const { repair } = harness()
    const bash = { title: "bash", output: "ok", metadata: {} }
    await repair["tool.execute.after"]({ tool: "bash", sessionID: "ses", callID: "c" }, bash)
    expect(bash.output).toBe("ok")
    const badArgs = { title: "Invalid Tool", output: "The arguments provided to the tool are invalid: expected string", metadata: {} }
    await repair["tool.execute.after"]({ tool: "invalid", sessionID: "ses", callID: "c", args: { tool: "bash", error: "expected string" } }, badArgs)
    expect(badArgs.output).toBe("The arguments provided to the tool are invalid: expected string")
  })
})

describe("one-shot continuation after a repaired call (fork 0.15 F)", () => {
  test("the turn that ended right after the repaired call with no answer gets one continuation", async () => {
    // given: the bench case — the invalid result, then an empty final step
    const { repair, sent, messages } = harness()
    messages.push(
      user("u1", "fix it"),
      assistant("a1", [{ type: "tool", tool: "bash", callID: "call-0" }]),
      assistant("a2", [{ type: "tool", tool: "invalid", callID: "call-1" }]),
      assistant("a3", [{ type: "text", text: "  " }]),
    )
    const { input, output } = invalidCall("bash\u0000")
    await repair["tool.execute.after"](input, output)

    // when: idle twice
    await repair.idle("ses")
    await repair.idle("ses")

    // then
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain("The tool is named 'bash'")
  })

  test("no continuation when the model answered, retried, the user spoke, or the turn was aborted", async () => {
    const cases: SessionMessage[][] = [
      [assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }]), assistant("a2", [{ type: "text", text: "Done." }])],
      [assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }]), assistant("a2", [{ type: "tool", tool: "bash", callID: "call-2" }])],
      [assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }]), user("u2", "stop")],
      [assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }]), assistant("a2", [], { name: "MessageAbortedError" })],
    ]
    for (const messages of cases) {
      const { repair, sent } = harness(messages)
      const { input, output } = invalidCall("bash\u0000")
      await repair["tool.execute.after"](input, output)
      await repair.idle("ses")
      expect(sent).toHaveLength(0)
    }
  })

  test("unknown names never trigger a continuation", async () => {
    const { repair, sent } = harness([assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }])])
    const { input, output } = invalidCall("analysis")
    await repair["tool.execute.after"](input, output)
    await repair.idle("ses")
    expect(sent).toHaveLength(0)
  })

  test("at most one per assistant message and a bounded number in a row; a real tool call resets the count", async () => {
    // given: the model keeps sending the broken name, one assistant message after another
    const { repair, sent, messages } = harness()
    for (let i = 1; i <= MAX_CONSECUTIVE_CONTINUATIONS + 1; i++) {
      messages.length = 0
      messages.push(assistant(`a${i}`, [{ type: "tool", tool: "invalid", callID: `call-${i}` }]))
      const { input, output } = invalidCall("bash\u0000", `call-${i}`)
      await repair["tool.execute.after"](input, output)
      await repair.idle("ses")
    }

    // then: the bound holds
    expect(sent).toHaveLength(MAX_CONSECUTIVE_CONTINUATIONS)

    // when: a real tool gets through, then the name breaks again
    await repair["tool.execute.after"]({ tool: "bash", sessionID: "ses", callID: "ok" }, { output: "ok" })
    messages.length = 0
    messages.push(assistant("a9", [{ type: "tool", tool: "invalid", callID: "call-9" }]))
    const { input, output } = invalidCall("bash\u0000", "call-9")
    await repair["tool.execute.after"](input, output)
    await repair.idle("ses")

    // then
    expect(sent).toHaveLength(MAX_CONSECUTIVE_CONTINUATIONS + 1)
  })

  test("subagent sessions are not continued (their parent collects them on idle)", async () => {
    const sent: string[] = []
    const repair = createToolNameRepair({
      fetchMessages: async () => [assistant("a1", [{ type: "tool", tool: "invalid", callID: "call-1" }])],
      continueSession: async (_sessionID, text) => {
        sent.push(text)
      },
      isSubagentSession: () => true,
    })
    const { input, output } = invalidCall("bash\u0000")
    await repair["tool.execute.after"](input, output)
    await repair.idle("ses")
    expect(output.output).toContain("The tool is named 'bash'")
    expect(sent).toHaveLength(0)
  })

  test("endedAfterCall ignores synthetic text and needs the call to be in an assistant message", () => {
    expect(endedAfterCall([assistant("a1", [{ type: "tool", callID: "c" }]), assistant("a2", [{ type: "text", text: "x", synthetic: true }])], "c")).toEqual({ messageID: "a1" })
    expect(endedAfterCall([user("u1", "hi")], "c")).toBeUndefined()
  })
})

describe("tool name repair wiring (fork 0.15 F)", () => {
  test("off when resilience or repair_tool_names is disabled, on by default", async () => {
    const { createPluginToolNameRepair } = await import("./plugin")
    const ctx = { client: {}, directory: "/tmp" } as never
    expect(createPluginToolNameRepair(ctx, { resilience: { enabled: false } } as never)).toBeNull()
    expect(createPluginToolNameRepair(ctx, { resilience: { repair_tool_names: false } } as never)).toBeNull()
    expect(createPluginToolNameRepair(ctx, {} as never)).not.toBeNull()
  })

  test("the resilience schema defaults repair_tool_names to true", async () => {
    const { ResilienceConfigSchema } = await import("../../config/schema/resilience")
    expect(ResilienceConfigSchema.parse({}).repair_tool_names).toBe(true)
    expect(ResilienceConfigSchema.parse({ repair_tool_names: false }).repair_tool_names).toBe(false)
  })
})
