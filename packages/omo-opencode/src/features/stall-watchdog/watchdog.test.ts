import { describe, expect, test } from "bun:test"

import { createStallWatchdog } from "./watchdog"

const INACTIVITY = 240_000

function setup(isNetworkRetry?: (message: unknown) => boolean) {
  let now = 0
  const watchdog = createStallWatchdog({ inactivityMs: INACTIVITY, now: () => now, ...(isNetworkRetry ? { isNetworkRetry } : {}) })
  return { watchdog, advance: (ms: number) => { now += ms } }
}

const busy = (sessionID: string) => ({ type: "session.status", properties: { sessionID, status: { type: "busy" } } })
const idle = (sessionID: string) => ({ type: "session.idle", properties: { sessionID } })
const delta = (sessionID: string) => ({ type: "message.part.delta", properties: { sessionID, delta: "x" } })
const tool = (sessionID: string, callID: string, status: string) => ({
  type: "message.part.updated",
  properties: { part: { sessionID, type: "tool", callID, state: { status } } },
})

describe("stall watchdog (fork 0.8a)", () => {
  test("a busy session with no output for the inactivity window is stalled", () => {
    const { watchdog, advance } = setup()
    watchdog.observe(busy("s1"))
    advance(INACTIVITY - 1)
    expect(watchdog.findStalled()).toEqual([])
    advance(2)
    expect(watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["s1"])
  })

  test("any output resets the window", () => {
    const { watchdog, advance } = setup()
    watchdog.observe(busy("s1"))
    advance(200_000)
    watchdog.observe(delta("s1"))
    advance(200_000)
    expect(watchdog.findStalled()).toEqual([])
  })

  test("a running tool is waiting, not stalled; after it ends the window starts again", () => {
    const { watchdog, advance } = setup()
    watchdog.observe(busy("s1"))
    watchdog.observe(tool("s1", "c1", "running"))
    advance(10 * INACTIVITY)
    expect(watchdog.findStalled()).toEqual([])
    watchdog.observe(tool("s1", "c1", "completed"))
    advance(INACTIVITY + 1)
    expect(watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["s1"])
  })

  test("a session with a managed process running is waiting, not stalled", () => {
    let now = 0
    const watchdog = createStallWatchdog({ inactivityMs: INACTIVITY, now: () => now, hasManagedProcess: (id) => id === "s1" })
    watchdog.observe(busy("s1"))
    now += 2 * INACTIVITY
    expect(watchdog.findStalled()).toEqual([])
  })

  test("idle sessions are never stalled and a reported stall is not reported again until new progress", () => {
    const { watchdog, advance } = setup()
    watchdog.observe(busy("s1"))
    advance(INACTIVITY + 1)
    expect(watchdog.findStalled()).toHaveLength(1)
    expect(watchdog.findStalled()).toHaveLength(0)
    expect(watchdog.isStalled("s1")).toBe(true)
    watchdog.observe(idle("s1"))
    expect(watchdog.isStalled("s1")).toBe(false)
    advance(10 * INACTIVITY)
    expect(watchdog.findStalled()).toEqual([])
  })

  test("counts stalls per task key so the budget can stop retries", () => {
    const { watchdog } = setup()
    expect(watchdog.recordStall("task-a")).toBe(1)
    expect(watchdog.recordStall("task-a")).toBe(2)
    expect(watchdog.recordStall("task-b")).toBe(1)
  })
})

describe("stall watchdog and network waits (fork 0.15)", () => {
  const retry = (sessionID: string, message = "fetch failed") => ({ type: "session.status", properties: { sessionID, status: { type: "retry", attempt: 1, message, next: 0 } } })
  const networkOnly = (message: unknown) => message === "fetch failed"

  test("a session in OpenCode's own retry backoff of a network cut is waiting, not stalled", () => {
    const { watchdog, advance } = setup(networkOnly)
    watchdog.observe(busy("s1"))
    watchdog.observe(retry("s1"))
    advance(INACTIVITY * 3)
    expect(watchdog.findStalled()).toEqual([])
  })

  test("a non-network retry (429, 5xx) or resilience disabled is not a wait", () => {
    // given: a rate-limit retry with resilience on, and a network retry with resilience off (no classifier)
    const rateLimited = setup(networkOnly)
    rateLimited.watchdog.observe(busy("s1"))
    rateLimited.watchdog.observe(retry("s1", "Rate limit exceeded"))
    const disabled = setup()
    disabled.watchdog.observe(busy("s1"))
    disabled.watchdog.observe(retry("s1"))

    // when
    rateLimited.advance(INACTIVITY + 1)
    disabled.advance(INACTIVITY + 1)

    // then
    expect(rateLimited.watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["s1"])
    expect(disabled.watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["s1"])
  })

  test("leaving the retry backoff restarts the window", () => {
    const { watchdog, advance } = setup(networkOnly)
    watchdog.observe(busy("s1"))
    watchdog.observe(retry("s1"))
    advance(INACTIVITY * 2)
    watchdog.observe(busy("s1"))
    advance(INACTIVITY - 1)
    expect(watchdog.findStalled()).toEqual([])
    advance(2)
    expect(watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["s1"])
  })

  test("a session waiting for the network (network guard) is not stalled", () => {
    let now = 0
    const watchdog = createStallWatchdog({ inactivityMs: INACTIVITY, now: () => now, isWaiting: (id) => id === "offline" })
    watchdog.observe(busy("offline"))
    watchdog.observe(busy("online"))
    now += INACTIVITY + 1
    expect(watchdog.findStalled().map((stall) => stall.sessionID)).toEqual(["online"])
  })

  test("after a freeze busy sessions restart their window", () => {
    const { watchdog, advance } = setup()
    watchdog.observe(busy("s1"))
    watchdog.observe(busy("s2"))
    watchdog.observe(idle("s2"))
    advance(INACTIVITY - 1)
    expect(watchdog.resetBusyProgress()).toEqual(["s1"])
    advance(INACTIVITY - 1)
    expect(watchdog.findStalled()).toEqual([])
  })
})
