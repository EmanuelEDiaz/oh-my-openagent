import { describe, expect, test } from "bun:test"

import type { Interruption } from "./store"
import type { WipMarker } from "./wip-marker"
import { createWipTracker, summarizeToolInput } from "./wip-tracker"

const MB = 1024 ** 2

function setup(options: { availableMb?: number; isWaiting?: (sessionID: string) => boolean } = {}) {
  const writes: WipMarker[] = []
  let removed = 0
  const recorded: Interruption[] = []
  let clock = 1000
  const availableMb = options.availableMb ?? 4000
  const tracker = createWipTracker({
    pid: 42,
    startedAt: 7,
    startSource: "proc",
    bootId: "boot",
    heartbeatMs: 15_000,
    thresholds: { lowMemoryMb: 700, lowMemoryRatio: 0.1 },
    sampleMemory: () => ({ rss: 0, systemUsedRatio: 0.5, availableBytes: availableMb * MB, totalBytes: 8000 * MB, psiFullAvg10: 1.5 }),
    readOomKills: () => 3,
    write: (marker) => writes.push(marker),
    remove: () => {
      removed++
    },
    record: (interruption) => recorded.push(interruption),
    now: () => clock,
    ...(options.isWaiting ? { isWaiting: options.isWaiting } : {}),
  })
  return { tracker, writes, recorded, removed: () => removed, tick: (ms: number) => (clock += ms) }
}

const status = (sessionID: string, type: string) => ({ type: "session.status", properties: { sessionID, status: { type } } })
const tool = (sessionID: string, callID: string, toolName: string, state: string, input: unknown = {}) => ({
  type: "message.part.updated",
  properties: { part: { type: "tool", sessionID, callID, tool: toolName, state: { status: state, input } } },
})

describe("work-in-progress marker tracker (fork 0.15)", () => {
  test("writes when a session gets busy, tracks open tools, removes the marker when all is idle", () => {
    const { tracker, writes, removed } = setup()
    tracker.onEvent(status("ses_a", "busy"))
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ pid: 42, startedAt: 7, startSource: "proc", bootId: "boot", oomKills: 3, memory: { availableMb: 4000, totalMb: 8000, psiFullAvg10: 1.5 } })

    tracker.onEvent({ type: "message.updated", properties: { info: { id: "msg_1", sessionID: "ses_a", role: "assistant", time: { created: 1 } } } })
    tracker.onEvent(tool("ses_a", "c1", "bash", "running", { command: "npm test" }))
    expect(writes.at(-1)!.sessions).toEqual([{ sessionID: "ses_a", messageID: "msg_1", openTools: [{ callID: "c1", tool: "bash", summary: "npm test" }], subtasks: [] }])

    const before = writes.length
    tracker.onEvent(tool("ses_a", "c1", "bash", "running", { command: "npm test" }))
    expect(writes).toHaveLength(before)

    tracker.onEvent(tool("ses_a", "c1", "bash", "completed"))
    expect(writes.at(-1)!.sessions[0]!.openTools).toEqual([])

    tracker.onEvent(status("ses_a", "idle"))
    expect(removed()).toBe(1)
    expect(tracker.snapshot()).toEqual([])
  })

  test("a subagent shows up as a subtask of its root session, even after the root went idle", () => {
    const { tracker, writes } = setup()
    tracker.onEvent({ type: "session.created", properties: { info: { id: "ses_child", parentID: "ses_root" } } })
    tracker.onEvent(status("ses_root", "busy"))
    tracker.onEvent(status("ses_child", "busy"))
    expect(writes.at(-1)!.sessions).toEqual([{ sessionID: "ses_root", openTools: [], subtasks: ["ses_child"] }])
    tracker.onEvent({ type: "session.idle", properties: { sessionID: "ses_root" } })
    expect(writes.at(-1)!.sessions).toEqual([{ sessionID: "ses_root", openTools: [], subtasks: ["ses_child"] }])
  })

  test("SIGTERM is remembered with the memory state; shutdown records busy work and removes the marker", () => {
    const { tracker, writes, recorded, removed } = setup({ availableMb: 300 })
    tracker.onEvent(status("ses_a", "busy"))
    tracker.onEvent(tool("ses_a", "c9", "edit", "running", { filePath: "src/a.ts", oldString: "a", newString: "b" }))
    tracker.onSigterm()
    expect(writes.at(-1)!.sigterm).toEqual({ at: 1000, lowMemory: true })

    const result = tracker.shutdown()
    expect(result).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ sessionID: "ses_a", cause: "killed", tools: [{ callID: "c9", tool: "edit", summary: "src/a.ts" }] })
    expect(recorded[0]!.detail).toContain("memory was low")
    expect(removed()).toBe(1)
  })

  test("a session waiting for the network after its error stays in the marker and is recorded on shutdown", () => {
    // given: the turn ended on a network error and the network guard waits for the connection
    const { tracker, writes, recorded, removed } = setup({ isWaiting: (sessionID) => sessionID === "ses_a" })
    tracker.onEvent(status("ses_a", "busy"))
    tracker.onEvent({ type: "session.error", properties: { sessionID: "ses_a", error: { name: "UnknownError", data: { message: "fetch failed" } } } })

    // then
    expect(removed()).toBe(0)
    expect(writes.at(-1)!.sessions.map((session) => session.sessionID)).toEqual(["ses_a"])

    // when OpenCode is closed during the wait
    tracker.shutdown()
    expect(recorded).toEqual([expect.objectContaining({ sessionID: "ses_a", cause: "network", detail: "OpenCode was closed while waiting for the network" })])
  })

  test("a clean shutdown with nothing busy records nothing", () => {
    const { tracker, recorded } = setup()
    expect(tracker.shutdown()).toEqual([])
    expect(recorded).toEqual([])
  })

  test("summaries prefer the command, the file or the description", () => {
    expect(summarizeToolInput("bash", { command: "git   status\n" })).toBe("git status")
    expect(summarizeToolInput("write", { filePath: "/x/y.ts", content: "..." })).toBe("/x/y.ts")
    expect(summarizeToolInput("task", { description: "Explore auth", prompt: "long" })).toBe("Explore auth")
    expect(summarizeToolInput("custom", { query: "q" })).toBe("q")
    expect(summarizeToolInput("todoread", undefined)).toBe("todoread")
  })

  test("the heartbeat rewrites the marker only while something is busy", async () => {
    const writes: WipMarker[] = []
    const tracker = createWipTracker({
      pid: 1, startedAt: 1, startSource: "plugin", heartbeatMs: 10, thresholds: { lowMemoryMb: 700, lowMemoryRatio: 0.1 },
      sampleMemory: () => ({ rss: 0, systemUsedRatio: 0 }), readOomKills: () => undefined,
      write: (marker) => writes.push(marker), remove: () => undefined,
    })
    tracker.start()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(writes).toHaveLength(0)
    tracker.onEvent(status("ses_a", "retry"))
    await new Promise((resolve) => setTimeout(resolve, 50))
    tracker.shutdown()
    expect(writes.length).toBeGreaterThan(2)
    expect(writes.at(-1)!.memory).toBeUndefined()
  })
})
