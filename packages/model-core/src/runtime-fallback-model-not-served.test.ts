import { describe, expect, test } from "bun:test"

import { isNetworkError } from "./network-error-classifier"
import { classifyRuntimeFallbackError, isRuntimeFallbackRetryableError } from "./runtime-fallback-error-classifier"

const DEFAULT_RETRY_CODES = [429, 500, 502, 503, 504] as const

// Exact session.error payload logged on 07-10-2026 for opencode/ling-3.0-flash-fin-free (listed by Zen, not served).
const ZEN_ROUTE_NOT_FOUND = {
  name: "APIError",
  data: {
    message: "Not Found: Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions",
    statusCode: 404,
    isRetryable: false,
    responseHeaders: {
      "cf-placement": "remote-ORD",
      "content-type": "application/json;charset=UTF-8",
      server: "cloudflare",
    },
    responseBody:
      "{\"status\":404,\"message\":\"Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions\"}",
    metadata: { url: "https://opencode.ai/zen/v1/chat/completions" },
  },
}

describe("model listed but not served", () => {
  test("Zen 404 'Cannot find any route' is model_not_found, retryable by fallback, and never a network cut", () => {
    expect(classifyRuntimeFallbackError(ZEN_ROUTE_NOT_FOUND)).toBe("model_not_found")
    expect(isRuntimeFallbackRetryableError(ZEN_ROUTE_NOT_FOUND, DEFAULT_RETRY_CODES)).toBe(true)
    expect(isNetworkError(ZEN_ROUTE_NOT_FOUND)).toBe(false)
  })

  test("other providers' wording for an unserved model is model_not_found too", () => {
    const messages = [
      "The model `foo-1` does not exist or you do not have access to it.",
      "model 'bar-free' is not served by this endpoint",
      "Model qux not found",
      "No such model: baz",
    ]
    for (const message of messages) {
      expect(classifyRuntimeFallbackError({ name: "APIError", data: { message, statusCode: 404 } })).toBe("model_not_found")
    }
  })

  test("a bare 404 or an unrelated 'not found' stays unclassified", () => {
    expect(classifyRuntimeFallbackError({ name: "APIError", data: { statusCode: 404, message: "Not Found" } })).toBeUndefined()
    expect(classifyRuntimeFallbackError({ name: "APIError", data: { message: "File not found: src/a.ts" } })).toBeUndefined()
  })
})
