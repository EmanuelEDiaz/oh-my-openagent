import { afterEach, describe, expect, test } from "bun:test"

import { getStallWatchdog, setStallWatchdog } from "../../features/stall-watchdog"
import { createStallWatchdogHook, type StallWatchdogHookDeps } from "./hook"

const MAIN = "ses_main"

function setup(overrides: Partial<StallWatchdogHookDeps> = {}) {
  let now = 0
  const calls = { aborted: [] as string[], toasts: [] as string[], continued: [] as Array<{ model?: string; text: string }> }
  const deps: StallWatchdogHookDeps = {
    now: () => now,
    isSubagentSession: (id) => id.startsWith("ses_child"),
    abort: async (id) => { calls.aborted.push(id) },
    toast: async (message) => { calls.toasts.push(message) },
    resolveTarget: async () => ({ agent: "sisyphus", model: "opencode/model-a" }),
    fallbackModels: () => ["opencode/model-b", "opencode/model-c"],
    continueSession: async (_id, input) => { calls.continued.push(input) },
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
})
