/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"

import { createStallWatchdog, setStallWatchdog } from "../stall-watchdog"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function manager(): BackgroundManager {
  const directory = tmpdir()
  const client = {
    session: {
      status: async () => ({ data: { "ses-bg": { type: "busy" } } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
      get: async () => ({ data: { id: "ses-bg" } }),
    },
  }
  return new BackgroundManager({
    pluginContext: { project: { id: "p", worktree: directory, time: { created: 0 } }, directory, worktree: directory, serverUrl: new URL("http://localhost:4096"), $: {} as PluginInput["$"], client: client as PluginInput["client"] },
  })
}

function runningTask(): BackgroundTask {
  return {
    id: "bg_stall", sessionId: "ses-bg", parentSessionId: "parent", parentMessageId: "pm", description: "d", prompt: "p",
    agent: "explore", status: "running", startedAt: new Date(), progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

function stalledWatchdog(maxStallsPerTask = 2) {
  let now = 0
  const watchdog = createStallWatchdog({ inactivityMs: 1000, now: () => now, maxStallsPerTask })
  watchdog.observe({ type: "session.status", properties: { sessionID: "ses-bg", status: { type: "busy" } } })
  now = 5000
  watchdog.findStalled()
  setStallWatchdog(watchdog)
  return watchdog
}

afterEach(() => setStallWatchdog(undefined))

describe("background tasks recover from a stalled model (fork 0.8a)", () => {
  test("a stalled task is retried on the next fallback model", async () => {
    // given
    stalledWatchdog()
    const bg = manager()
    const task = runningTask()
    bg["tasks"].set(task.id, task)
    const retries: Array<{ name?: string; message?: string }> = []
    bg["tryFallbackRetry"] = async (_task: BackgroundTask, errorInfo: { name?: string; message?: string }) => { retries.push(errorInfo); return true }

    // when
    await bg["pollRunningTasks"]()
    bg.shutdown()

    // then
    expect(retries).toHaveLength(1)
    expect(retries[0]?.message).toContain("stalled")
  })

  test("over the stall budget the task is cancelled with a clear reason instead of retried forever", async () => {
    // given
    const watchdog = stalledWatchdog(1)
    watchdog.recordStall("bg_stall")
    const bg = manager()
    const task = runningTask()
    bg["tasks"].set(task.id, task)
    let retried = false
    bg["tryFallbackRetry"] = async () => { retried = true; return true }
    const cancelled: Array<{ source?: string; reason?: string }> = []
    bg.cancelTask = async (_id: string, options?: { source?: string; reason?: string }) => { cancelled.push(options ?? {}); return true }

    // when
    await bg["pollRunningTasks"]()
    bg.shutdown()

    // then
    expect(retried).toBe(false)
    expect(cancelled[0]?.source).toBe("stall-watchdog")
    expect(cancelled[0]?.reason).toContain("stalled")
  })
})
