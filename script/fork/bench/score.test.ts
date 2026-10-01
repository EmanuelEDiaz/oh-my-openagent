import { describe, expect, test } from "bun:test"

import { classifyFailure, isConfigError, passHatK, summarize } from "./score"
import type { RunResult } from "./types"

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
    ]) {
      expect(classifyFailure(error)).toBe("infra")
    }
  })

  test("anything else is a task failure", () => {
    expect(classifyFailure("ContextOverflowError")).toBe("task")
    expect(classifyFailure("MessageOutputLengthError")).toBe("task")
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
