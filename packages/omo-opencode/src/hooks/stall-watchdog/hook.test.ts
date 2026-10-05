import { afterEach, describe, expect, test } from "bun:test"

import { getStallWatchdog, setStallWatchdog } from "../../features/stall-watchdog"
import { createStallWatchdogHook, type StallWatchdogHookDeps } from "./hook"

const MAIN = "ses_main"

function setup(overrides: Partial<StallWatchdogHookDeps> = {}) {
  let now = 0
  const calls = { aborted: [] as string[], toasts: [] as string[], continued: [] as Array<{ model?: string; text: string }>, paused: [] as string[] }
  const deps: StallWatchdogHookDeps = {
    now: () => now,
    isSubagentSession: (id) => id.startsWith("ses_child"),
    abort: async (id) => { calls.aborted.push(id) },
    toast: async (message) => { calls.toasts.push(message) },
    resolveTarget: async () => ({ agent: "sisyphus", model: "opencode/model-a" }),
    fallbackModels: () => ["opencode/model-b", "opencode/model-c"],
    continueSession: async (_id, input) => { calls.continued.push(input) },
    pause: async (id, reason) => { calls.paused.push(`${id}: ${reason}`) },
    ...overrides,
  }
  const hook = createStallWatchdogHook({ inactivityMs: 1000, checkIntervalMs: 60_000, maxStallsPerTask: 2 }, deps)
  return { hook, calls, advance: (ms: number) => { now += ms } }
}

const busy = (sessionID: string) => ({ event: { type: "session.status", properties: { sessionID, status: { type: "busy" } } } })

afterEach(() => setStallWatchdog(undefined))

describe("stall watchdog hook (fork 0.8a)", () => {
  test("registers the shared watchdog so sync and background owners can see stalls", () => {
    const { hook } = setup()
    expect(getStallWatchdog()).toBeDefined()
    hook.dispose()
  })

  test("a stalled main session is stopped, the user is told, and it continues on the next fallback model", async () => {
    // given
    const { hook, calls, advance } = setup()
    await hook.event(busy(MAIN))
    advance(1001)

    // when
    await hook.check()

    // then
    expect(calls.aborted).toEqual([MAIN])
    expect(calls.toasts[0]).toContain("model-b")
    expect(calls.continued[0]?.model).toBe("opencode/model-b")
    expect(calls.continued[0]?.text).toContain("stalled")
    hook.dispose()
  })

  test("over the budget it stops and tells the user instead of retrying forever", async () => {
    // given
    const { hook, calls, advance } = setup()
    for (let stall = 0; stall < 3; stall++) {
      await hook.event(busy(MAIN))
      await hook.event({ event: { type: "message.part.delta", properties: { sessionID: MAIN } } })
      advance(1001)
      await hook.check()
    }

    // then
    expect(calls.continued).toHaveLength(2)
    expect(calls.continued[1]?.model).toBe("opencode/model-c")
    expect(calls.toasts.at(-1)).toContain("Stopped")
    expect(calls.toasts.at(-1)).toContain("/omo-resume")
    expect(calls.paused).toEqual(["ses_main: the model stalled 3 times"])
    hook.dispose()
  })

  test("subagent sessions are left to their owners", async () => {
    // given
    const { hook, calls, advance } = setup()
    await hook.event(busy("ses_child_1"))
    advance(1001)

    // when
    await hook.check()

    // then
    expect(calls.aborted).toEqual([])
    expect(getStallWatchdog()?.isStalled("ses_child_1")).toBe(true)
    hook.dispose()
  })

  test("without fallback models it continues on the same model", async () => {
    const { hook, calls, advance } = setup({ fallbackModels: () => [] })
    await hook.event(busy(MAIN))
    advance(1001)
    await hook.check()
    expect(calls.continued[0]?.model).toBe("opencode/model-a")
    hook.dispose()
  })

  test("a main session that ended on a stream timeout continues on the next fallback model", async () => {
    // given
    const { hook, calls } = setup()

    // when
    await hook.event({ event: { type: "session.error", properties: { sessionID: MAIN, error: { name: "APIError", data: { message: "SSE read timed out" } } } } })
    await Bun.sleep(1)

    // then
    expect(calls.continued[0]?.model).toBe("opencode/model-b")
    expect(calls.aborted).toEqual([])
    hook.dispose()
  })

  test("other errors and subagent errors are not handled here", async () => {
    const { hook, calls } = setup()
    await hook.event({ event: { type: "session.error", properties: { sessionID: MAIN, error: { name: "APIError", data: { message: "401 unauthorized" } } } } })
    await hook.event({ event: { type: "session.error", properties: { sessionID: "ses_child_9", error: { data: { message: "SSE read timed out" } } } } })
    await Bun.sleep(1)
    expect(calls.continued).toEqual([])
    hook.dispose()
  })
})

describe("stall watchdog hook and network cuts / freezes (fork 0.15)", () => {
  test("a stall the network guard takes over is not counted, charged or moved to another model", async () => {
    // given
    let charged = 0
    const { hook, calls, advance } = setup({
      takeOverStall: async () => true,
      chargeBudget: () => { charged++; return { used: charged, max: 5, exhausted: false } },
    })
    await hook.event(busy(MAIN))
    advance(1001)

    // when
    await hook.check()

    // then
    expect(charged).toBe(0)
    expect(calls.aborted).toEqual([])
    expect(calls.continued).toEqual([])
    expect(calls.toasts).toEqual([])
    hook.dispose()
  })

  test("a stream timeout caused by the network is left to the guard as well", async () => {
    let charged = 0
    const stops: boolean[] = []
    const { hook, calls } = setup({
      takeOverStall: async (_id, opts) => { stops.push(opts.stopped); return true },
      chargeBudget: () => { charged++; return undefined },
    })
    await hook.event({ event: { type: "session.error", properties: { sessionID: MAIN, error: { name: "APIError", data: { message: "SSE read timed out" } } } } })
    await Bun.sleep(1)
    expect(stops).toEqual([true])
    expect(charged).toBe(0)
    expect(calls.continued).toEqual([])
    hook.dispose()
  })

  test("a real model stall still charges the budget and falls back", async () => {
    let charged = 0
    const { hook, calls, advance } = setup({
      takeOverStall: async () => false,
      chargeBudget: () => { charged++; return { used: charged, max: 5, exhausted: false } },
    })
    await hook.event(busy(MAIN))
    advance(1001)
    await hook.check()
    expect(charged).toBe(1)
    expect(calls.continued[0]?.model).toBe("opencode/model-b")
    hook.dispose()
  })

  test("sessions waiting for the network are not stalls", async () => {
    const { hook, calls, advance } = setup({ isWaiting: () => true })
    await hook.event(busy(MAIN))
    advance(1001)
    await hook.check()
    expect(calls.aborted).toEqual([])
    hook.dispose()
  })

  describe("freeze detection", () => {
    function freezeSetup(clock: { monotonic: number; wall: number }) {
      const freezes: Array<{ sessions: readonly string[]; seconds: number; kind: string }> = []
      let now = 0
      const deps: StallWatchdogHookDeps = {
        now: () => now,
        monotonicNow: () => clock.monotonic,
        wallNow: () => clock.wall,
        isSubagentSession: () => false,
        abort: async () => undefined,
        toast: async () => undefined,
        resolveTarget: async () => ({}),
        fallbackModels: () => [],
        continueSession: async () => undefined,
        onFreeze: (sessions, seconds, kind) => { freezes.push({ sessions, seconds, kind }) },
      }
      const hook = createStallWatchdogHook({ inactivityMs: 1000, checkIntervalMs: 15_000, maxStallsPerTask: 2, freezeThresholdMs: 10_000 }, deps)
      return { hook, freezes, advanceProgressClock: (ms: number) => { now += ms } }
    }

    test("a late tick on the monotonic clock is a freeze: busy sessions restart and the guard probes", async () => {
      // given
      const clock = { monotonic: 0, wall: 0 }
      const { hook, freezes, advanceProgressClock } = freezeSetup(clock)
      await hook.event(busy(MAIN))
      advanceProgressClock(1001)

      // when: the 15 s tick arrives 75 s late
      clock.monotonic += 90_000
      clock.wall += 90_000
      await hook.check()

      // then
      expect(freezes).toEqual([{ sessions: [MAIN], seconds: 75, kind: "freeze" }])
      expect(getStallWatchdog()?.isStalled(MAIN)).toBe(false)
      hook.dispose()
    })

    test("a wall-clock jump the monotonic clock did not see is a suspend", async () => {
      const clock = { monotonic: 0, wall: 0 }
      const { hook, freezes } = freezeSetup(clock)
      clock.monotonic += 15_000
      clock.wall += 15_000 + 3_600_000
      await hook.check()
      expect(freezes).toEqual([{ sessions: [], seconds: 3600, kind: "suspend" }])
      hook.dispose()
    })

    test("a normal or slightly late tick is not a freeze", async () => {
      const clock = { monotonic: 0, wall: 0 }
      const { hook, freezes } = freezeSetup(clock)
      clock.monotonic += 24_000
      clock.wall += 24_000
      await hook.check()
      expect(freezes).toEqual([])
      hook.dispose()
    })
  })
})

