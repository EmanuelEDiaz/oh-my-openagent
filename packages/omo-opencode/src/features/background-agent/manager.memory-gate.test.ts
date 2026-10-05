import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import type { PluginInput } from "@opencode-ai/plugin"

import { BackgroundManager } from "./manager"
import { createMemoryGate } from "./memory-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

const MB = 1024 ** 2

describe("BackgroundManager low-RAM gate (fork 0.15 E)", () => {
  test("a new subagent stays queued while memory is low and starts once it recovers", async () => {
    // given
    let availableMb = 300
    const prompts: string[] = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => ({ data: { id: "ses_child" } }),
        promptAsync: async () => {
          prompts.push("sent")
          return {}
        },
        abort: async () => ({}),
      },
    }
    let manager: BackgroundManager | undefined
    const gate = createMemoryGate({
      lowMemoryMb: 700,
      lowMemoryRatio: 0,
      resumeMemoryMb: 900,
      sample: () => ({ rss: 0, systemUsedRatio: 0, availableBytes: availableMb * MB, totalBytes: 8000 * MB }),
      // Pretend another subagent runs, so the no-deadlock rule does not let this one through.
      runningCount: () => 1 + (manager?.runningSubagentCount() ?? 0),
      toast: () => undefined,
      recheckMs: 10,
    })
    manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }), memoryGate: gate })

    // when
    const task = await manager.launch({ description: "Test task", prompt: "Do something", agent: "explore", parentSessionId: "ses_parent", parentMessageId: "msg_parent" })
    await new Promise((resolve) => setTimeout(resolve, 60))

    // then
    expect(manager.getTask(task.id)?.status).toBe("pending")
    expect(prompts).toHaveLength(0)

    availableMb = 1000
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(prompts).toHaveLength(1)
    manager.shutdown()
  })

  test("a running parent task does not count against its own queued child (no parent/child deadlock)", async () => {
    // given
    let created = 0
    let availableMb = 2000
    const prompts: string[] = []
    const client = {
      session: {
        get: async () => ({ data: { directory: "/parent" } }),
        create: async () => ({ data: { id: `ses_bg_${++created}` } }),
        promptAsync: async () => {
          prompts.push("sent")
          return {}
        },
        abort: async () => ({}),
      },
    }
    let manager: BackgroundManager | undefined
    const gate = createMemoryGate({
      lowMemoryMb: 700,
      lowMemoryRatio: 0,
      resumeMemoryMb: 900,
      sample: () => ({ rss: 0, systemUsedRatio: 0, availableBytes: availableMb * MB, totalBytes: 8000 * MB }),
      runningCount: (label) => manager?.runningSubagentCount(label) ?? 0,
      toast: () => undefined,
      recheckMs: 10,
    })
    manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }), memoryGate: gate })
    const parent = await manager.launch({ description: "Parent", prompt: "Delegate", agent: "explore", parentSessionId: "ses_main", parentMessageId: "msg_main" })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(manager.getTask(parent.id)?.status).toBe("running")
    const parentSession = manager.getTask(parent.id)!.sessionId!

    // when: memory drops and the parent (a background task) launches its child
    availableMb = 300
    const child = await manager.launch({ description: "Child", prompt: "Work", agent: "explore", parentSessionId: parentSession, parentMessageId: "msg_parent" })
    await new Promise((resolve) => setTimeout(resolve, 60))

    // then: the parent does not count, nothing else runs, so the child is let through
    expect(manager.runningSubagentCount()).toBe(2)
    expect(manager.getTask(child.id)?.status).toBe("running")
    expect(prompts).toHaveLength(2)
    manager.shutdown()
  })

  test("sync subagents are counted while they hold their slot", async () => {
    const manager = new BackgroundManager({ pluginContext: unsafeTestValue<PluginInput>({ client: { session: {} }, directory: tmpdir() }) })
    await manager.acquireSyncSubagentConcurrency("openai/gpt")
    expect(manager.runningSubagentCount()).toBe(1)
    manager.releaseSyncSubagentConcurrency("openai/gpt")
    expect(manager.runningSubagentCount()).toBe(0)
    manager.shutdown()
  })
})
