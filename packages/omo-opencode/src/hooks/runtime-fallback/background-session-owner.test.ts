/// <reference types="bun-types" />

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"

import { ConcurrencyManager } from "../../features/background-agent/concurrency"
import type { OpencodeClient, QueueItem } from "../../features/background-agent/constants"
import { tryFallbackRetry } from "../../features/background-agent/fallback-retry-handler"
import { BackgroundManager } from "../../features/background-agent/manager"
import type { BackgroundTask } from "../../features/background-agent/types"
import { setNetworkGuard, type NetworkGuard } from "../../features/network-guard"
import { isBackgroundTaskSession } from "../../shared/background-session-owner"
import { listBrokenModels } from "../../shared/broken-models-cache"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import type { AutoRetryHelpers } from "./auto-retry"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

// Real-use incidents A3 follow-up: with runtime_fallback on by default, a background task's session error must get
// exactly one fallback, from the BackgroundManager, which owns the task; runtime-fallback steps aside.
const SESSION = "ses-bg-404"
const ZEN_MESSAGE = "Not Found: Cannot find any route matching [POST] https://opencode.ai/zen/v1/chat/completions"
const ZEN_ROUTE_NOT_FOUND = { name: "APIError", data: { message: ZEN_MESSAGE, statusCode: 404, isRetryable: false } }

function backgroundManager(): BackgroundManager {
  const directory = tmpdir()
  const client = { session: { abort: async () => ({}), messages: async () => ({ data: [] }), promptAsync: async () => ({}) } }
  return new BackgroundManager({
    pluginContext: { project: { id: "p", worktree: directory, time: { created: 0 } }, directory, worktree: directory, serverUrl: new URL("http://localhost:4096"), $: {} as PluginInput["$"], client: client as unknown as PluginInput["client"] },
  })
}

function backgroundTask(): BackgroundTask {
  return {
    id: "bg_404", sessionId: SESSION, parentSessionId: "parent", parentMessageId: "pm", description: "d", prompt: "p",
    agent: "explore", status: "running", startedAt: new Date(), progress: { toolCalls: 0, lastUpdate: new Date() },
    model: { providerID: "opencode", modelID: "ling-3.0-flash-fin-free" },
    fallbackChain: [{ model: "big-pickle", providers: ["opencode"] }],
    attemptCount: 0,
  }
}

function runtimeFallback(retried: string[]) {
  const ctx: RuntimeFallbackPluginInput = {
    client: {
      session: { abort: async () => ({}), messages: async () => ({ data: [] }), promptAsync: async () => ({}) },
      tui: { showToast: async () => ({}) },
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
  SessionCategoryRegistry.register(SESSION, "quick")
  return createRuntimeFallbackHook(
    ctx,
    { pluginConfig: { categories: { quick: { fallback_models: ["opencode/big-pickle"] } } } as never },
    { createAutoRetryHelpers: () => helpers },
  )
}

async function backgroundPath(task: BackgroundTask, errorInfo: { name?: string; message?: string; statusCode?: number }) {
  const processKey = mock(() => {})
  const retried = await tryFallbackRetry({
    task,
    errorInfo,
    source: "session.error",
    concurrencyManager: new ConcurrencyManager(),
    client: { session: { abort: mock(async () => ({})) } } as unknown as OpencodeClient,
    idleDeferralTimers: new Map(),
    queuesByKey: new Map<string, QueueItem[]>(),
    processKey,
    deps: { readConnectedProvidersCache: () => null, readProviderModelsCache: () => null },
  })
  return { retried, dispatches: processKey.mock.calls.length }
}

let cacheHome = ""
let previousCacheHome: string | undefined
let manager: BackgroundManager | undefined

beforeEach(() => {
  previousCacheHome = process.env.XDG_CACHE_HOME
  cacheHome = mkdtempSync(join(tmpdir(), "omo-bg-owner-"))
  process.env.XDG_CACHE_HOME = cacheHome
})

afterEach(async () => {
  await manager?.shutdown()
  manager = undefined
  setNetworkGuard(undefined)
  SessionCategoryRegistry.clear()
  if (previousCacheHome === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = previousCacheHome
  rmSync(cacheHome, { recursive: true, force: true })
})

describe("one fallback path per background task session", () => {
  it("#given a background task on a model Zen does not serve #when its session gets the 404 #then exactly one fallback and the model is remembered", async () => {
    // given
    manager = backgroundManager()
    const task = backgroundTask()
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
    const runtimeRetried: string[] = []
    const hook = runtimeFallback(runtimeRetried)
    await hook.event({ event: { type: "session.created", properties: { info: { id: SESSION, model: "opencode/ling-3.0-flash-fin-free" } } } })

    // when: the same session.error reaches both listeners, as in the plugin's event fan-out
    await hook.event({ event: { type: "session.error", properties: { sessionID: SESSION, error: ZEN_ROUTE_NOT_FOUND } } })
    const background = await backgroundPath(task, { name: "APIError", message: ZEN_MESSAGE })

    // then
    expect({ runtime: runtimeRetried.length, background: background.dispatches }).toEqual({ runtime: 0, background: 1 })
    expect(background.retried).toBe(true)
    expect(isBackgroundTaskSession(SESSION)).toBe(true)
    expect(listBrokenModels().has("opencode/ling-3.0-flash-fin-free")).toBe(true)
    hook.dispose?.()
  })

  it("#given a background task #when the network drops #then neither path switches model: the network guard owns it", async () => {
    // given
    const notified: string[] = []
    setNetworkGuard({
      notifyNetworkError: (sessionID: string) => { notified.push(sessionID); return true },
      isWaiting: () => false,
    } as unknown as NetworkGuard)
    manager = backgroundManager()
    const task = backgroundTask()
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(task.id, task)
    const runtimeRetried: string[] = []
    const hook = runtimeFallback(runtimeRetried)

    // when
    await hook.event({ event: { type: "session.error", properties: { sessionID: SESSION, error: { name: "UnknownError", data: { message: "fetch failed" } } } } })
    const background = await backgroundPath(task, { name: "UnknownError", message: "fetch failed" })

    // then
    expect(runtimeRetried).toEqual([])
    expect(background.dispatches).toBe(0)
    expect(notified.length).toBeGreaterThan(0)
    hook.dispose?.()
  })

  it("#given a session the BackgroundManager does not track (main or sync subagent) #then runtime-fallback still owns it", async () => {
    manager = backgroundManager()
    expect(isBackgroundTaskSession("ses-main")).toBe(false)
  })
})
