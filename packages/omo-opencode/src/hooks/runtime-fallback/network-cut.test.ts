import { afterEach, describe, expect, it } from "bun:test"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"
import type { AutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { createEventHandler } from "./event-handler"
import { createMessageUpdateHandler } from "./message-update-handler"
import { createSessionStatusHandler } from "./session-status-handler"
import { dispatchFallbackRetry } from "./fallback-retry-dispatcher"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { setNetworkGuard, type NetworkGuard } from "../../features/network-guard"

function createContext(): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
        promptAsync: async () => ({}),
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(): HookDeps {
  return {
    ctx: createContext(),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 4,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: {
      git_master: { commit_footer: true, include_co_authored_by: true, git_env_prefix: "GIT_MASTER_" },
      categories: { test: { fallback_models: ["openai/gpt-5.4", "google/gemini-2.5-pro"] } },
    },
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  } as HookDeps
}

function createHelpers(calls: { aborted: string[]; retried: string[] }): AutoRetryHelpers {
  return {
    abortSessionRequest: async (sessionID: string) => { calls.aborted.push(sessionID) },
    clearSessionFallbackTimeout: () => {},
    scheduleSessionFallbackTimeout: () => {},
    autoRetryWithFallback: async (_sessionID: string, model: string) => {
      calls.retried.push(model)
      return { accepted: true, status: "dispatched" }
    },
    resolveAgentForSessionFromContext: async () => undefined,
    cleanupStaleSessions: () => {},
  }
}

function fakeGuard(waiting: boolean) {
  const notified: Array<{ sessionID: string; gaveUp: boolean }> = []
  const guard = {
    notifyNetworkError: (sessionID: string, _error: unknown, opts: { gaveUp: boolean }) => {
      notified.push({ sessionID, gaveUp: opts.gaveUp })
      return true
    },
    isWaiting: () => waiting,
  } as unknown as NetworkGuard
  setNetworkGuard(guard)
  return notified
}

function setupSession(sessionID: string) {
  SessionCategoryRegistry.clear()
  SessionCategoryRegistry.register(sessionID, "test")
  const deps = createDeps()
  const state = createFallbackState("anthropic/claude-opus-4-7")
  deps.sessionStates.set(sessionID, state)
  const calls = { aborted: [] as string[], retried: [] as string[] }
  return { deps, state, calls, helpers: createHelpers(calls) }
}

afterEach(() => {
  setNetworkGuard(undefined)
  SessionCategoryRegistry.clear()
})

describe("runtime-fallback and network cuts (fork 0.15)", () => {
  it("#given a network session.error #when it arrives #then no model switch, no attempt, no cooldown, and the guard is told", async () => {
    // given
    const sessionID = "ses-network-error"
    const { deps, state, calls, helpers } = setupSession(sessionID)
    const notified = fakeGuard(false)
    const handler = createEventHandler(deps, helpers)

    // when
    await handler({ event: { type: "session.error", properties: { sessionID, error: { name: "UnknownError", data: { message: "fetch failed" } } } } })

    // then
    expect(calls.retried).toEqual([])
    expect(state.attemptCount).toBe(0)
    expect(state.failedModels.size).toBe(0)
    expect(notified).toEqual([{ sessionID, gaveUp: true }])
  })

  it("#given a 429 session.error #when it arrives #then the fallback path still switches model", async () => {
    const sessionID = "ses-rate-limit"
    const { deps, calls, helpers } = setupSession(sessionID)
    fakeGuard(false)
    const handler = createEventHandler(deps, helpers)

    await handler({ event: { type: "session.error", properties: { sessionID, error: { statusCode: 429, message: "Too Many Requests" } } } })

    expect(calls.retried).toEqual(["openai/gpt-5.4"])
  })

  it("#given OpenCode retrying a network error #when the retry status arrives #then its retry is never aborted", async () => {
    // given
    const sessionID = "ses-network-retry"
    const { deps, calls, helpers } = setupSession(sessionID)
    const notified = fakeGuard(false)
    const handler = createSessionStatusHandler(deps, helpers, deps.sessionStatusRetryKeys)

    // when
    await handler({ sessionID, status: { type: "retry", attempt: 1, message: "Connection reset by server" } })

    // then
    expect(calls.aborted).toEqual([])
    expect(calls.retried).toEqual([])
    expect(notified).toEqual([{ sessionID, gaveUp: false }])
  })

  it("#given an assistant message ending on a network error #when message.updated arrives #then no fallback", async () => {
    const sessionID = "ses-network-message"
    const { deps, state, calls, helpers } = setupSession(sessionID)
    const notified = fakeGuard(false)
    const handler = createMessageUpdateHandler(deps, helpers)

    await handler({ info: { sessionID, role: "assistant", model: "anthropic/claude-opus-4-7", error: { name: "APIError", data: { message: "socket hang up", isRetryable: true } } } })

    expect(calls.retried).toEqual([])
    expect(state.attemptCount).toBe(0)
    expect(notified).toEqual([{ sessionID, gaveUp: true }])
  })

  it("#given a session waiting for the network #when a fallback timeout dispatches #then it is skipped", async () => {
    const sessionID = "ses-waiting"
    const { deps, state, calls, helpers } = setupSession(sessionID)
    fakeGuard(true)

    await dispatchFallbackRetry(deps, helpers, { sessionID, state, fallbackModels: ["openai/gpt-5.4"], source: "timeout" })

    expect(calls.retried).toEqual([])
    expect(state.attemptCount).toBe(0)
  })
})
