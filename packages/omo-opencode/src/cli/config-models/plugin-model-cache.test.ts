/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { groupModelsByProvider, seedPluginModelCache } from "./plugin-model-cache"

describe("seedPluginModelCache", () => {
  test("writes connected providers and their model ids, keeping slashes inside model ids", () => {
    // given
    const written: unknown[] = []

    // when
    const count = seedPluginModelCache(["opencode/big-pickle", "openrouter/qwen/qwen3.7-plus", "opencode/deepseek-v4-flash"], {
      writeConnected: (connected) => written.push({ connected }),
      writeModels: (data) => written.push(data),
    })

    // then
    expect(count).toBe(2)
    expect(written).toEqual([
      { connected: ["opencode", "openrouter"] },
      {
        connected: ["opencode", "openrouter"],
        models: { opencode: ["big-pickle", "deepseek-v4-flash"], openrouter: ["qwen/qwen3.7-plus"] },
      },
    ])
  })

  test("writes nothing for an empty list", () => {
    // given
    let calls = 0

    // when
    const count = seedPluginModelCache([], { writeConnected: () => calls++, writeModels: () => calls++ })

    // then
    expect(count).toBe(0)
    expect(calls).toBe(0)
    expect(groupModelsByProvider(["no-slash"])).toEqual({})
  })
})
