import { describe, expect, test } from "bun:test"

import { shouldRetryError } from "./model-error-classifier"

describe("a stalled stream cut by chunkTimeout is retryable on another model (fork 0.8a)", () => {
  test("OpenCode's stream timeout errors", () => {
    expect(shouldRetryError({ message: "SSE read timed out" })).toBe(true)
    expect(shouldRetryError({ name: "APIError", message: "SSE read timed out" })).toBe(true)
    expect(shouldRetryError({ name: "ProviderResponseStreamError", message: "stream ended" })).toBe(true)
  })
})
