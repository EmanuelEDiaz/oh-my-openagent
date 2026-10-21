import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import { setNetworkGuard, type NetworkGuard } from "../../features/network-guard"
import { listBrokenModels, markModelBroken } from "../../shared/broken-models-cache"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import type { AutoRetryHelpers } from "./auto-retry"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

// Real-use incidents 07-10-2026 (fork plan real-use-incidents A2, A3): the plugin runs with no runtime_fallback key.
const ZEN_ROUTE_NOT_FOUND = {
  name: "APIError",
  data: {
    message: "Not Found: Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions",
    statusCode: 404,
    isRetryable: false,
    responseBody: "{\"status\":404,\"message\":\"Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions\"}",
    metadata: { url: "https://opencode.ai/zen/v1/chat/completions" },
  },
}

function setup(sessionID: string, fallbackModels: string[]) {
  const toasts: string[] = []
  const retried: string[] = []
  const ctx: RuntimeFallbackPluginInput = {
    client: {
      session: { abort: async () => ({}), messages: async () => ({ data: [] }), promptAsync: async () => ({}) },
      tui: { showToast: async (input) => { toasts.push(input.body.message); return {} } },
    },
    directory: "/test/dir",
  }
  const helpers: AutoRetryHelpers = {
    abortSessionRequest: async () => {},
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID: string, model: string) => {
      retried.push(model)
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
  SessionCategoryRegistry.register(sessionID, "quick")
  const hook = createRuntimeFallbackHook(
    ctx,
    { pluginConfig: { categories: { quick: { fallback_models: fallbackModels } } } as never },
    { createAutoRetryHelpers: () => helpers },
  )
  const created = { type: "session.created", properties: { info: { id: sessionID, model: "opencode/ling-3.0-flash-fin-free" } } }
  return { hook, toasts, retried, created }
}

let cacheHome = ""
let previousCacheHome: string | undefined

beforeEach(() => {
  previousCacheHome = process.env.XDG_CACHE_HOME
  cacheHome = mkdtempSync(join(tmpdir(), "omo-broken-models-"))
  process.env.XDG_CACHE_HOME = cacheHome
})

afterEach(() => {
  setNetworkGuard(undefined)
  SessionCategoryRegistry.clear()
  if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = previousCacheHome
  rmSync(cacheHome, { recursive: true, force: true })
})

describe("runtime fallback on by default (real-use incidents A2, A3)", () => {
  it("#given no runtime_fallback config #when the model answers 404 route-not-found #then it switches, says why and remembers the model", async () => {
    // given
    const { hook, toasts, retried, created } = setup("ses-zen-404", ["opencode/big-pickle"])
    await hook.event({ event: created })

    // when
    await hook.event({ event: { type: "session.error", properties: { sessionID: "ses-zen-404", error: ZEN_ROUTE_NOT_FOUND } } })

    // then
    expect(retried).toEqual(["opencode/big-pickle"])
    expect(toasts.at(-1)).toBe("ling-3.0-flash-fin-free is not served → switched to big-pickle")
    expect(listBrokenModels().has("opencode/ling-3.0-flash-fin-free")).toBe(true)
    hook.dispose?.()
  })

  it("#given no runtime_fallback config #when the network drops #then no fallback: the network guard keeps the same model", async () => {
    // given
    const notified: string[] = []
    setNetworkGuard({
      notifyNetworkError: (sessionID: string) => { notified.push(sessionID); return true },
      isWaiting: () => false,
    } as unknown as NetworkGuard)
    const { hook, retried, created } = setup("ses-net", ["opencode/big-pickle"])
    await hook.event({ event: created })

    // when
    await hook.event({ event: { type: "session.error", properties: { sessionID: "ses-net", error: { name: "UnknownError", data: { message: "fetch failed" } } } } })

    // then
    expect(retried).toEqual([])
    expect(notified).toEqual(["ses-net"])
    hook.dispose?.()
  })

  it("#given a fallback marked not served #when the primary fails #then the chain steps over it", async () => {
    // given
    markModelBroken("opencode/space-bunny-free", "Cannot find any route")
    const { hook, retried, created } = setup("ses-skip", ["opencode/space-bunny-free", "opencode/big-pickle"])
    await hook.event({ event: created })

    // when
    await hook.event({ event: { type: "session.error", properties: { sessionID: "ses-skip", error: ZEN_ROUTE_NOT_FOUND } } })

    // then
    expect(retried).toEqual(["opencode/big-pickle"])
    hook.dispose?.()
  })
})
