import { afterEach, describe, expect, mock, test } from "bun:test"

import { setNetworkGuard, type NetworkGuard } from "../network-guard"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { tryFallbackRetry } from "./fallback-retry-handler"
import type { BackgroundTask } from "./types"

function createTask(): BackgroundTask {
  return {
    id: "task-network",
    description: "test task",
    prompt: "test prompt",
    agent: "sisyphus-junior",
    status: "running",
    parentSessionId: "parent-session-1",
    parentMessageId: "parent-message-1",
    sessionId: "ses-child",
    fallbackChain: [{ model: "fallback-model-1", providers: ["provider-b"], variant: undefined }],
    attemptCount: 0,
    concurrencyKey: "provider-a/original-model",
    model: { providerID: "provider-a", modelID: "original-model" },
  }
}

function run(errorInfo: { name?: string; message?: string; statusCode?: number }, source: string) {
  const task = createTask()
  const release = mock(() => {})
  const result = tryFallbackRetry({
    task,
    errorInfo,
    source,
    concurrencyManager: { release, acquire: mock(async () => {}), getConcurrencyKey: (key: string) => key } as unknown as ConcurrencyManager,
    client: { session: { abort: mock(async () => ({})) } } as unknown as OpencodeClient,
    idleDeferralTimers: new Map(),
    queuesByKey: new Map<string, QueueItem[]>(),
    processKey: () => {},
    deps: { log: () => {}, readProviderModelsCache: () => null, readConnectedProvidersCache: () => null },
  })
  return { task, result, release }
}

afterEach(() => setNetworkGuard(undefined))

describe("background fallback retry and network cuts (fork 0.15)", () => {
  test("a network session.error keeps the model, the attempt count and the concurrency slot; the guard is told", async () => {
    // given
    const notified: Array<{ sessionID: string; gaveUp: boolean }> = []
    setNetworkGuard({ notifyNetworkError: (sessionID: string, _e: unknown, opts: { gaveUp: boolean }) => { notified.push({ sessionID, gaveUp: opts.gaveUp }); return true } } as unknown as NetworkGuard)

    // when
    const { task, result, release } = run({ name: "UnknownError", message: "fetch failed" }, "session.error")

    // then
    expect(await result).toBe(false)
    expect(task.attemptCount).toBe(0)
    expect(task.model?.modelID).toBe("original-model")
    expect(release).not.toHaveBeenCalled()
    expect(notified).toEqual([{ sessionID: "ses-child", gaveUp: true }])
  })

  test("OpenCode's own retry status on a network error spends no attempt", async () => {
    const { task, result } = run({ name: "SessionRetry", message: "Connection reset by server" }, "session.status")
    expect(await result).toBe(false)
    expect(task.attemptCount).toBe(0)
  })

  test("a 429 still falls back", async () => {
    const { task, result } = run({ name: "APIError", message: "Too Many Requests", statusCode: 429 }, "session.error")
    expect(await result).toBe(true)
    expect(task.attemptCount).toBe(1)
  })

  test("prompt dispatch failures (local OpenCode server) keep their own handling", async () => {
    const notified: string[] = []
    setNetworkGuard({ notifyNetworkError: (sessionID: string) => { notified.push(sessionID); return true } } as unknown as NetworkGuard)
    const { result } = run({ name: "Error", message: "Unable to connect" }, "promptAsync.launch")
    await result
    expect(notified).toEqual([])
  })
})
