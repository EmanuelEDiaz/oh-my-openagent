import { describe, expect, test } from "bun:test"

import { applyChunkTimeoutDefaults } from "./stall-chunk-timeout"

describe("applyChunkTimeoutDefaults (fork 0.8a)", () => {
  test("adds chunkTimeout to opencode and to connected providers that have none", () => {
    // given
    const config: Record<string, unknown> = { provider: { groq: { options: { apiKey: "x" } } } }

    // when
    applyChunkTimeoutDefaults(config, ["groq", "openrouter"], 90_000)

    // then
    expect(config.provider).toEqual({
      groq: { options: { apiKey: "x", chunkTimeout: 90_000 } },
      openrouter: { options: { chunkTimeout: 90_000 } },
      opencode: { options: { chunkTimeout: 90_000 } },
    })
  })

  test("never overrides a value the user set, including false", () => {
    // given
    const config: Record<string, unknown> = {
      provider: { opencode: { options: { chunkTimeout: 300_000 } }, groq: { options: { chunkTimeout: false } } },
    }

    // when
    applyChunkTimeoutDefaults(config, ["groq"], 90_000)

    // then
    expect((config.provider as Record<string, { options: Record<string, unknown> }>).opencode!.options.chunkTimeout).toBe(300_000)
    expect((config.provider as Record<string, { options: Record<string, unknown> }>).groq!.options.chunkTimeout).toBe(false)
  })

  test("disabled with false: config untouched", () => {
    // given
    const config: Record<string, unknown> = {}

    // when
    applyChunkTimeoutDefaults(config, ["groq"], false)

    // then
    expect(config).toEqual({})
  })
})
