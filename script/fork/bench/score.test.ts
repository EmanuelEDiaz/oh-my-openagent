import { describe, expect, test } from "bun:test"

import { classifyFailure, isConfigError, isConnectivityError, isQuotaError, passHatK, silentModelError, summarize } from "./score"
import type { RunResult, Transcript } from "./types"

describe("classifyFailure", () => {
  test("provider and transport problems are infrastructure", () => {
    for (const error of [
      "403 free tier can only be used from within OpenCode",
      "429 Too Many Requests",
      "rate limit exceeded",
      "turn timed out after 240s",
      "fetch failed: ECONNREFUSED",
      "503 Service Unavailable",
      "model is overloaded",
      "ProviderModelNotFoundError: big-pickle-free",
      "server error creating session: {}",
      "server unresponsive",
      "APIError: Upstream request failed: Endpoint is unavailable.",
      // The bench's own proxy when the machine loses its connection (14-10-2026).
      "APIError: upstream unreachable: getaddrinfo EAI_AGAIN opencode.ai",
      "getaddrinfo ENOTFOUND opencode.ai",
      "connect ENETUNREACH 1.2.3.4:443",
      "connect EHOSTUNREACH 1.2.3.4:443",
    ]) {
      expect(classifyFailure(error)).toBe("infra")
    }
  })

  test("anything else is a task failure", () => {
    expect(classifyFailure("ContextOverflowError")).toBe("task")
    expect(classifyFailure("MessageOutputLengthError")).toBe("task")
  })
})

describe("isConnectivityError", () => {
  test("a lost connection is told apart from a provider refusing the request", () => {
    expect(isConnectivityError("APIError: upstream unreachable: getaddrinfo EAI_AGAIN opencode.ai")).toBe(true)
    expect(isConnectivityError("fetch failed: ECONNREFUSED")).toBe(true)
    expect(isConnectivityError("connect ENETUNREACH 1.2.3.4:443")).toBe(true)
    expect(isConnectivityError("429 Too Many Requests")).toBe(false)
    expect(isConnectivityError("turn timed out after 240s")).toBe(false)
  })
})

describe("silentModelError", () => {
  const transcript = (overrides: Partial<Transcript>): Transcript => ({
    agent: "Sisyphus - ultraworker",
    model: "opencode/big-pickle",
    answer: "",
    tools: [],
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    cost: 0,
    turns: 1,
    durationMs: 135_141,
    delegatedAgents: [],
    ...overrides,
  })

  test("#given a turn where the model never answered (seen 14-10-2026, connection down) #then it is an infrastructure error", () => {
    expect(silentModelError(transcript({}))).toMatch(/no output/)
    expect(classifyFailure(silentModelError(transcript({})) ?? "")).toBe("infra")
  })

  test("#given the model spent tokens, called a tool, or wrote an answer #then the run is the agent's to score", () => {
    expect(silentModelError(transcript({ tokens: { input: 900, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }))).toBeUndefined()
    expect(silentModelError(transcript({ answer: "The spec and the test contradict each other." }))).toBeUndefined()
    expect(silentModelError(transcript({ tools: [{ tool: "read", status: "error", input: {} }] }))).toBeUndefined()
  })
})

describe("isConfigError", () => {
  test("a configured model OpenCode no longer offers is a configuration error, not worth retrying", () => {
    expect(isConfigError("Tool execution failed: Model not found: opencode/deepseek-v4-flash-free. Did you mean: deepseek-v4-flash?")).toBe(true)
    expect(isConfigError("Agent not found: \"explore\"")).toBe(true)
    expect(isConfigError("429 Too Many Requests")).toBe(false)
  })

  test("configuration errors are never scored against the agent", () => {
    expect(classifyFailure("Model not found: opencode/x")).toBe("infra")
  })
})

// 27-10-2026: Zen's free quota ran out mid-baseline; OpenCode kept retrying in silence, the stall watchdog aborted the
// turn at 255 s and the bench burnt every retry on "model produced no output".
const ZEN_FREE_LIMIT = "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go"

describe("isQuotaError", () => {
  test("#given the provider's quota ran out #then the whole bench must stop, retrying cannot help today", () => {
    expect(isQuotaError(ZEN_FREE_LIMIT)).toBe(true)
    expect(isQuotaError(`provider usage limit reached: ${ZEN_FREE_LIMIT}`)).toBe(true)
    expect(isQuotaError("FreeUsageLimitError")).toBe(true)
    expect(isQuotaError("provider usage limit reached: Free usage exceeded, subscribe to Go (free_tier_limit; retry after 2026-10-28T00:00:00.000Z)")).toBe(true)
  })

  test("#given a passing rate limit or another failure #then it is not a quota stop", () => {
    expect(isQuotaError("429 Too Many Requests")).toBe(false)
    expect(isQuotaError("rate limit exceeded")).toBe(false)
    expect(isQuotaError("model produced no output (0 tokens, no tool calls, empty answer after 255s)")).toBe(false)
  })

  test("#given a quota stop #then it is never scored against the agent", () => {
    expect(classifyFailure(ZEN_FREE_LIMIT)).toBe("infra")
  })
})

describe("passHatK", () => {
  test("is the chance that k runs drawn from n all pass", () => {
    expect(passHatK(3, 3, 3)).toBe(1)
    expect(passHatK(3, 2, 3)).toBe(0)
    expect(passHatK(5, 4, 3)).toBeCloseTo(0.4)
    expect(passHatK(2, 2, 3)).toBeUndefined()
  })
})

function run(taskId: string, repeat: number, pass: boolean | undefined, tokens = 100): RunResult {
  return {
    taskId,
    repeat,
    attempt: 0,
    pass,
    failure: pass === undefined ? "infra" : pass ? undefined : "task",
    grades: [],
    transcript: pass === undefined
      ? undefined
      : {
          agent: "explore",
          model: "m",
          answer: "",
          tools: [],
          tokens: { input: tokens, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          cost: 0,
          turns: 1,
          durationMs: 10,
          delegatedAgents: [],
        },
  }
}

describe("summarize", () => {
  test("pass@1 and pass^3 ignore infrastructure failures", () => {
    const summary = summarize([
      run("a", 0, true), run("a", 1, true), run("a", 2, true),
      run("b", 0, true), run("b", 1, false), run("b", 2, true), run("b", 3, undefined),
    ], 3)
    expect(summary.passAt1).toBeCloseTo((1 + 2 / 3) / 2)
    expect(summary.passHatK).toBeCloseTo(0.5)
    expect(summary.infraFailures).toBe(1)
    expect(summary.tasks.find((task) => task.taskId === "b")?.scored).toBe(3)
  })

  test("mean tokens are over scored runs only", () => {
    const summary = summarize([run("a", 0, true, 100), run("a", 1, false, 300), run("a", 2, undefined)], 3)
    expect(summary.meanTokens).toBe(200)
  })
})
