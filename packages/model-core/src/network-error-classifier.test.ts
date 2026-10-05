import { describe, expect, test } from "bun:test"

import { isNetworkError } from "./network-error-classifier"

function errnoError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe("isNetworkError", () => {
  test.each([
    "read ECONNRESET",
    "connect ECONNREFUSED 127.0.0.1:443",
    "getaddrinfo ENOTFOUND api.anthropic.com",
    "getaddrinfo EAI_AGAIN api.openai.com",
    "connect ETIMEDOUT 1.2.3.4:443",
    "connect ENETUNREACH 1.2.3.4:443",
    "connect EHOSTUNREACH 1.2.3.4:443",
    "write EPIPE",
    "fetch failed",
    "socket hang up",
    "other side closed",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
    "ERR_SSL_SSLV3_ALERT_BAD_RECORD_MAC",
    "ConnectionRefused",
    "FailedToOpenSocket",
    "ConnectionClosed",
    "Unable to connect. Is the computer able to access the url?",
    "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
    "Connection reset by server",
    "Connection error.",
    "Network error",
  ])("recognises the transport failure %p", (message) => {
    expect(isNetworkError(message)).toBe(true)
    expect(isNetworkError(new Error(message))).toBe(true)
  })

  test("reads the code of a Node errno error", () => {
    expect(isNetworkError(errnoError("request to https://x failed", "EAI_AGAIN"))).toBe(true)
  })

  test("reads the cause chain of undici's fetch failure", () => {
    //#given
    const error = new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) })

    //#then
    expect(isNetworkError(error)).toBe(true)
  })

  test("reads OpenCode's session.error shape", () => {
    expect(isNetworkError({ name: "UnknownError", data: { message: "Error: fetch failed" } })).toBe(true)
    expect(isNetworkError({ name: "APIError", data: { message: "Connection reset by server", isRetryable: true } })).toBe(true)
  })

  test("treats a retryable APIError without an HTTP status as a network cut", () => {
    expect(isNetworkError({ name: "APIError", data: { message: "Cannot reach provider", isRetryable: true } })).toBe(true)
  })

  test.each([
    { name: "APIError", data: { message: "Too Many Requests", statusCode: 429, isRetryable: true } },
    { name: "APIError", data: { message: "Internal Server Error", statusCode: 500, isRetryable: true } },
    { name: "APIError", data: { message: "Bad Gateway", statusCode: 502, isRetryable: true } },
    { name: "APIError", data: { message: "Service Unavailable", statusCode: 503, isRetryable: true } },
    { name: "APIError", data: { message: "Overloaded", statusCode: 529, isRetryable: true } },
    // A status code wins even when the body text sounds like a network failure.
    { name: "APIError", data: { message: "upstream connect error: connection reset", statusCode: 502 } },
    { statusCode: 504, message: "socket hang up" },
  ])("never treats a response with a status code as a network cut: %p", (error) => {
    expect(isNetworkError(error)).toBe(false)
  })

  test.each([
    { name: "APIError", data: { message: "Provider is overloaded", isRetryable: true } },
    { name: "APIError", data: { message: "Rate limit exceeded, retrying", isRetryable: true } },
    { name: "APIError", data: { message: "Service temporarily unavailable", isRetryable: true } },
    { name: "APIError", data: { message: "quota exceeded", isRetryable: true } },
    { name: "APIError", data: { message: "Bad Gateway: {\"error\":{\"message\":\"unknown provider for model x\"}}", isRetryable: true } },
    { name: "APIError", data: { message: "Internal server error", isRetryable: true } },
    { name: "APIError", data: { message: "upstream returned 502", isRetryable: true } },
    { name: "APIError", data: { message: "{\"type\":\"error\",\"error\":{\"type\":\"api_error\"}}", isRetryable: true } },
  ])("keeps provider answers without a status field on the fallback path: %p", (error) => {
    expect(isNetworkError(error)).toBe(false)
  })

  test.each([
    undefined,
    null,
    "",
    "429: too many requests",
    "Invalid API key",
    "Model not found: openai/gpt-x",
    { name: "ProviderAuthError", data: { message: "Unauthorized", statusCode: 401 } },
    { name: "APIError", data: { message: "Bad request", isRetryable: false } },
    { name: "MessageAbortedError", data: { message: "Aborted" } },
    { name: "ContextOverflowError", data: { message: "prompt is too long" } },
    { name: "ProviderResponseStreamError", data: { message: "SSE read timed out" } },
  ])("does not flag model, auth or abort errors: %p", (error) => {
    expect(isNetworkError(error)).toBe(false)
  })

  test("survives hostile objects and cycles", () => {
    //#given
    const cyclic: Record<string, unknown> = { message: "boom" }
    cyclic.cause = cyclic
    const hostile = new Proxy({}, { get: () => { throw new Error("trap") } })

    //#then
    expect(isNetworkError(cyclic)).toBe(false)
    expect(isNetworkError(hostile)).toBe(false)
  })
})
