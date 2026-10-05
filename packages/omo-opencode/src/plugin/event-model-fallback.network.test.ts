import { afterEach, describe, expect, test } from "bun:test"

import { _resetForTesting, setMainSession } from "../features/claude-code-session-state"
import { setNetworkGuard, type NetworkGuard } from "../features/network-guard"
import { createModelFallbackHook, hasPendingModelFallback } from "../hooks/model-fallback/hook"
import { createModelFallbackEventHandler } from "./event-model-fallback"
import type { PluginEventContext } from "./event-types"

const MAIN = "ses-main-network"

function setup() {
  _resetForTesting()
  setMainSession(MAIN)
  const notified: Array<{ sessionID: string; gaveUp: boolean }> = []
  setNetworkGuard({ notifyNetworkError: (sessionID: string, _e: unknown, opts: { gaveUp: boolean }) => { notified.push({ sessionID, gaveUp: opts.gaveUp }); return true } } as unknown as NetworkGuard)
  const modelFallback = createModelFallbackHook()
  const handler = createModelFallbackEventHandler({
    pluginConfig: {} as never,
    pluginContext: { client: {}, directory: "/tmp" } as unknown as PluginEventContext,
    modelFallback,
    isModelFallbackEnabled: true,
    isRuntimeFallbackEnabled: false,
    // No auto-continue: only whether a fallback model gets queued is observed.
    shouldAutoRetrySession: () => false,
    isSessionStopped: () => false,
  })
  return { handler, modelFallback, notified }
}

afterEach(() => {
  setNetworkGuard(undefined)
  _resetForTesting()
})

describe("model-fallback and network cuts (fork 0.15)", () => {
  test("a network session.error queues no fallback model and reaches the guard", async () => {
    // given
    const { handler, modelFallback, notified } = setup()

    // when
    await handler.handleSessionError({ sessionID: MAIN, errorName: "UnknownError", errorMessage: "fetch failed", props: { error: { name: "UnknownError", data: { message: "fetch failed" } } } })

    // then
    expect(hasPendingModelFallback(modelFallback, MAIN)).toBe(false)
    expect(notified).toEqual([{ sessionID: MAIN, gaveUp: true }])
  })

  test("OpenCode retrying a network error is left alone", async () => {
    const { handler, modelFallback, notified } = setup()
    await handler.handleSessionStatus({ sessionID: MAIN, status: { type: "retry", attempt: 1, message: "Connection reset by server", next: 0 } })
    expect(hasPendingModelFallback(modelFallback, MAIN)).toBe(false)
    expect(notified).toEqual([{ sessionID: MAIN, gaveUp: false }])
  })

  test("an assistant network error queues no fallback model", async () => {
    const { handler, modelFallback } = setup()
    await handler.handleAssistantMessageUpdated({ sessionID: MAIN, info: { id: "msg-1", error: { name: "APIError", data: { message: "socket hang up", isRetryable: true } } } })
    expect(hasPendingModelFallback(modelFallback, MAIN)).toBe(false)
  })

  test("a rate limit is not a network cut and still queues a fallback", async () => {
    const { handler, modelFallback, notified } = setup()
    await handler.handleSessionError({ sessionID: MAIN, errorName: "APIError", errorMessage: "Rate limit exceeded", props: { error: { name: "APIError", data: { message: "Rate limit exceeded", statusCode: 429 } } } })
    expect(notified).toEqual([])
    expect(hasPendingModelFallback(modelFallback, MAIN)).toBe(true)
  })
})
