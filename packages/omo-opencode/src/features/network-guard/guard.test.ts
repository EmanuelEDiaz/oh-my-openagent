import { afterEach, describe, expect, test } from "bun:test"

import { createNetworkGuard, networkChangedText, type NetworkGuardDeps, type NetworkGuardOptions } from "./guard"
import { getNetworkGuard, setNetworkGuard, setNetworkResilienceEnabled, stepAsideForNetwork } from "./index"

const MAIN = "ses_main"
const NEUTRAL = "https://neutral.test/generate_204"
const PROVIDER = "https://api.provider.test/v1"

const NETWORK_ERROR = { name: "UnknownError", data: { message: "fetch failed" } }

type Reach = { neutral: boolean; provider: boolean }

function setup(script: Reach[], overrides: Partial<NetworkGuardDeps> = {}, options: Partial<NetworkGuardOptions> = {}) {
  let now = 1_000_000
  let probeRound = 0
  const calls = {
    probes: [] as string[],
    delays: [] as number[],
    toasts: [] as string[],
    continued: [] as Array<{ sessionID: string; text: string }>,
    aborted: [] as string[],
    handedOff: [] as string[],
    interrupted: [] as Array<{ sessionID: string; detail: string }>,
  }
  const reachAt = (round: number): Reach => script[Math.min(round, script.length - 1)] ?? { neutral: true, provider: true }
  const deps: NetworkGuardDeps = {
    now: () => now,
    random: () => 0.5,
    // Every wait completes at once and moves the clock.
    schedule: (fn, ms) => {
      calls.delays.push(ms)
      now += ms
      queueMicrotask(fn)
      return () => undefined
    },
    probe: async (url) => {
      calls.probes.push(url)
      const reach = reachAt(Math.floor(probeRound++ / 2))
      return url === NEUTRAL ? reach.neutral : reach.provider
    },
    providerProbeUrl: async () => PROVIDER,
    toast: async (message) => { calls.toasts.push(message) },
    continueSession: async (sessionID, text) => { calls.continued.push({ sessionID, text }) },
    abort: async (sessionID) => { calls.aborted.push(sessionID) },
    handOff: async (sessionID) => { calls.handedOff.push(sessionID) },
    recordInterruption: (sessionID, detail) => { calls.interrupted.push({ sessionID, detail }) },
    ...overrides,
  }
  const guard = createNetworkGuard(
    { probeLimit: 12, backoffS: [5, 15, 30, 60], neutralProbeUrl: NEUTRAL, silentStreamMs: 60_000, checkIntervalMs: 0, ...options },
    deps,
  )
  return { guard, calls, advance: (ms: number) => { now += ms } }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

const OFF: Reach = { neutral: false, provider: false }
const ON: Reach = { neutral: true, provider: true }
const PROVIDER_DOWN: Reach = { neutral: true, provider: false }

const event = (type: string, properties: Record<string, unknown>) => ({ event: { type, properties } })
const busy = (sessionID = MAIN) => event("session.status", { sessionID, status: { type: "busy" } })
const sessionError = (error: unknown, sessionID = MAIN) => event("session.error", { sessionID, error })

afterEach(() => {
  setNetworkGuard(undefined)
  setNetworkResilienceEnabled(true)
})

describe("network guard (fork 0.15 A)", () => {
  test("OpenCode's own retry is only shown, never probed or aborted", async () => {
    // given
    const { guard, calls } = setup([OFF])

    // when
    guard.event(event("session.status", { sessionID: MAIN, status: { type: "retry", attempt: 2, message: "fetch failed", next: 1_004_000 } }))
    await settle()

    // then
    expect(guard.isWaiting(MAIN)).toBe(true)
    expect(calls.toasts).toEqual(["Sin conexión · OpenCode reintenta (intento 2) en 4 s"])
    expect(calls.probes).toEqual([])
    expect(calls.aborted).toEqual([])
    guard.dispose()
  })

  test("a non-network retry (rate limit) is left to the fallback path", async () => {
    const { guard, calls } = setup([OFF])
    guard.event(event("session.status", { sessionID: MAIN, status: { type: "retry", attempt: 1, message: "Rate limit exceeded", next: 0 } }))
    await settle()
    expect(guard.isWaiting(MAIN)).toBe(false)
    expect(calls.toasts).toEqual([])
    guard.dispose()
  })

  test("when OpenCode gives up it waits for the network and continues the same session on the same model", async () => {
    // given
    const { guard, calls } = setup([OFF, OFF, ON])

    // when
    guard.event(sessionError(NETWORK_ERROR))
    await settle()

    // then
    expect(calls.probes).toEqual([NEUTRAL, PROVIDER, NEUTRAL, PROVIDER, NEUTRAL, PROVIDER])
    expect(calls.toasts.slice(0, 2)).toEqual(["Sin conexión · reintento 2/12 en 5 s", "Sin conexión · reintento 3/12 en 15 s"])
    expect(calls.toasts[2]).toContain("Conexión recuperada tras 20 s")
    expect(calls.continued).toEqual([{ sessionID: MAIN, text: expect.stringContaining("Connection restored after 20 s") }])
    expect(calls.continued[0]?.text).toContain("check the effect of any tool call that was cut before repeating it")
    // OpenCode had already ended the turn: nothing to abort, nothing handed to a fallback model.
    expect(calls.aborted).toEqual([])
    expect(calls.handedOff).toEqual([])
    expect(guard.isWaiting(MAIN)).toBe(false)
    guard.dispose()
  })

  test("an assistant message ending on a network error starts the same wait", async () => {
    const { guard, calls } = setup([ON])
    guard.event(event("message.updated", { info: { sessionID: MAIN, role: "assistant", error: { name: "APIError", data: { message: "Connection reset by server", isRetryable: true } } } }))
    await settle()
    expect(calls.continued).toHaveLength(1)
    guard.dispose()
  })

  test("waits follow the configured backoff, the last step repeats, each with ±25 % jitter", async () => {
    // given
    const { guard, calls } = setup([OFF, OFF, OFF, OFF, OFF, ON])

    // when
    guard.event(sessionError(NETWORK_ERROR))
    await settle()

    // then
    expect(calls.delays).toEqual([5_000, 15_000, 30_000, 60_000, 60_000])
    guard.dispose()

    const low = setup([OFF, ON], { random: () => 0 })
    low.guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(low.calls.delays).toEqual([3_750])
    low.guard.dispose()

    const high = setup([OFF, ON], { random: () => 1 })
    high.guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(high.calls.delays).toEqual([6_250])
    high.guard.dispose()
  })

  test("respects retry-after when it is longer than the backoff", async () => {
    const { guard, calls } = setup([OFF, ON])
    guard.event(sessionError({ name: "APIError", data: { message: "socket hang up", isRetryable: true, responseHeaders: { "retry-after": "90" } } }))
    await settle()
    expect(calls.delays).toEqual([90_000])
    guard.dispose()
  })

  test("at the probe limit it records the interruption and never switches model", async () => {
    // given
    const { guard, calls } = setup([OFF], {}, { probeLimit: 3 })

    // when
    guard.event(sessionError(NETWORK_ERROR))
    await settle()

    // then
    expect(calls.probes).toHaveLength(6)
    expect(calls.interrupted).toEqual([{ sessionID: MAIN, detail: "no connection for 20 s (3 probes)" }])
    expect(calls.toasts.at(-1)).toContain("El trabajo está guardado")
    expect(calls.continued).toEqual([])
    expect(calls.handedOff).toEqual([])
    expect(guard.isWaiting(MAIN)).toBe(false)
    guard.dispose()
  })

  test("only the provider unreachable: after one grace cycle it hands off to the fallback path", async () => {
    const { guard, calls } = setup([PROVIDER_DOWN, PROVIDER_DOWN])
    guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(calls.delays).toHaveLength(1)
    expect(calls.toasts[0]).toBe("Proveedor sin respuesta · reintento 2/12 en 5 s")
    expect(calls.handedOff).toEqual([MAIN])
    expect(calls.continued).toEqual([])
    guard.dispose()
  })

  test("a provider blip that recovers within the grace cycle stays on the same model", async () => {
    const { guard, calls } = setup([PROVIDER_DOWN, ON])
    guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(calls.handedOff).toEqual([])
    expect(calls.continued).toHaveLength(1)
    guard.dispose()
  })

  test("the provider answering is enough even when the neutral site is blocked", async () => {
    const { guard, calls } = setup([{ neutral: false, provider: true }])
    guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(calls.delays).toEqual([])
    expect(calls.continued).toHaveLength(1)
    guard.dispose()
  })

  test("without a provider URL the neutral site decides", async () => {
    const { guard, calls } = setup([{ neutral: true, provider: false }], { providerProbeUrl: async () => undefined })
    guard.event(sessionError(NETWORK_ERROR))
    await settle()
    expect(calls.probes).toEqual([NEUTRAL])
    expect(calls.continued).toHaveLength(1)
    guard.dispose()
  })

  test("errors that are not network cuts are ignored", async () => {
    const { guard, calls } = setup([OFF])
    guard.event(sessionError({ name: "APIError", data: { message: "Too Many Requests", statusCode: 429, isRetryable: true } }))
    expect(guard.notifyNetworkError(MAIN, { message: "Invalid API key" }, { gaveUp: true })).toBe(false)
    await settle()
    expect(calls.probes).toEqual([])
    expect(guard.isWaiting(MAIN)).toBe(false)
    guard.dispose()
  })

  test("a repeated network error during a wait does not start a second cycle", async () => {
    // given: a wait that never ends on its own
    const { guard, calls } = setup([OFF], { schedule: () => () => undefined })

    // when
    guard.event(sessionError(NETWORK_ERROR))
    await settle()
    guard.event(sessionError(NETWORK_ERROR))
    guard.notifyNetworkError(MAIN, NETWORK_ERROR, { gaveUp: true })
    await settle()

    // then
    expect(calls.probes).toHaveLength(2)
    guard.dispose()
  })

  describe("silent stream (no error, dead connection)", () => {
    test("a busy session without data for silent_stream_s is probed; offline → cut, then stopped and continued", async () => {
      // given
      const { guard, calls, advance } = setup([OFF, ON])
      guard.event(busy())
      advance(60_001)

      // when
      await guard.tick()
      await settle()

      // then
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued).toHaveLength(1)
      guard.dispose()
    })

    test("silence with the network up is a model matter: the stall watchdog decides", async () => {
      const { guard, calls, advance } = setup([ON])
      guard.event(busy())
      advance(60_001)
      await guard.tick()
      await guard.tick()
      await settle()
      expect(calls.probes).toHaveLength(2)
      expect(calls.continued).toEqual([])
      expect(calls.aborted).toEqual([])
      guard.dispose()
    })

    test("a running tool is not silence", async () => {
      const { guard, calls, advance } = setup([OFF])
      guard.event(busy())
      guard.event(event("message.part.updated", { part: { sessionID: MAIN, type: "tool", callID: "c1", state: { status: "running" } } }))
      advance(60_001)
      await guard.tick()
      expect(calls.probes).toEqual([])
      guard.dispose()
    })

    test("data coming back by itself ends the wait without a continuation", async () => {
      // given
      const { guard, calls, advance } = setup([OFF], { schedule: () => () => undefined })
      guard.event(busy())
      advance(60_001)
      await guard.tick()
      await settle()
      expect(guard.isWaiting(MAIN)).toBe(true)

      // when
      guard.event(event("message.part.delta", { sessionID: MAIN }))
      await settle()

      // then
      expect(guard.isWaiting(MAIN)).toBe(false)
      expect(calls.continued).toEqual([])
      expect(calls.aborted).toEqual([])
      guard.dispose()
    })
  })

  describe("stall watchdog hand-over", () => {
    test("offline: the guard takes the stall over", async () => {
      const { guard, calls } = setup([OFF], { schedule: () => () => undefined })
      expect(await guard.takeOverStall(MAIN, { stopped: true })).toBe(true)
      expect(guard.isWaiting(MAIN)).toBe(true)
      expect(calls.continued).toEqual([])
      guard.dispose()
    })

    test("online and no freeze: a real model stall", async () => {
      const { guard } = setup([ON])
      expect(await guard.takeOverStall(MAIN, { stopped: false })).toBe(false)
      guard.dispose()
    })

    test("a session already waiting for the network is never a stall", async () => {
      const { guard, calls } = setup([ON])
      guard.event(event("session.status", { sessionID: MAIN, status: { type: "retry", attempt: 1, message: "ECONNRESET", next: 1_002_000 } }))
      expect(await guard.takeOverStall(MAIN, { stopped: false })).toBe(true)
      expect(calls.probes).toEqual([])
      guard.dispose()
    })

    test("silent since a freeze: resumed on the same model", async () => {
      // given
      const { guard, calls } = setup([ON])
      guard.event(busy())
      guard.afterFreeze([MAIN], 42)
      await settle()
      expect(calls.continued).toEqual([])

      // when
      expect(await guard.takeOverStall(MAIN, { stopped: false })).toBe(true)

      // then
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued[0]?.text).toContain("frozen for 42 s")
      guard.dispose()
    })
  })

  describe("freeze (0.15 B)", () => {
    test("probes busy sessions; offline turns into a cut", async () => {
      const { guard, calls } = setup([OFF], { schedule: () => () => undefined })
      guard.event(busy())
      guard.event(busy("ses_idle"))
      guard.event(event("session.idle", { sessionID: "ses_idle" }))
      guard.afterFreeze([MAIN, "ses_idle"], 30)
      await settle()
      expect(calls.probes).toEqual([NEUTRAL, PROVIDER])
      expect(guard.isWaiting(MAIN)).toBe(true)
      guard.dispose()
    })

    test("online: the session that stays silent is resumed by the silent-stream check", async () => {
      // given
      const { guard, calls, advance } = setup([ON])
      guard.event(busy())
      guard.afterFreeze([MAIN], 30)
      await settle()

      // when
      advance(60_001)
      await guard.tick()
      await settle()

      // then
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued[0]?.text).toContain("frozen for 30 s")
      guard.dispose()
    })

    test("online: a session whose stream resumes is left alone", async () => {
      const { guard, calls, advance } = setup([ON])
      guard.event(busy())
      guard.afterFreeze([MAIN], 30)
      await settle()
      guard.event(event("message.part.delta", { sessionID: MAIN }))
      advance(60_001)
      await guard.tick()
      await settle()
      expect(calls.continued).toEqual([])
      guard.dispose()
    })
  })

  describe("network change watch", () => {
    test("runs only while a session waits and wakes the probe at once", async () => {
      // given
      let onChange: (() => void) | undefined
      let stopped = 0
      const { guard, calls, advance } = setup([OFF, ON], {
        schedule: () => () => undefined,
        watchLink: (callback) => {
          onChange = callback
          return { stop: () => { stopped++ } }
        },
      })

      // when
      guard.event(sessionError(NETWORK_ERROR))
      await settle()
      expect(onChange).toBeDefined()
      expect(calls.continued).toEqual([])
      advance(3_000)
      onChange?.()
      await settle()

      // then
      expect(calls.continued).toHaveLength(1)
      expect(stopped).toBe(1)
      guard.dispose()
    })

    test("ignores a burst of changes right after a probe", async () => {
      let onChange: (() => void) | undefined
      const { guard, calls } = setup([OFF, ON], {
        schedule: () => () => undefined,
        watchLink: (callback) => {
          onChange = callback
          return { stop: () => undefined }
        },
      })
      guard.event(sessionError(NETWORK_ERROR))
      await settle()
      onChange?.()
      await settle()
      expect(calls.probes).toHaveLength(2)
      guard.dispose()
    })
  })
})

describe("sidebar view (snapshot + onChange)", () => {
  test("between probes it shows the attempt, the verdict and when the next probe runs; online clears it", async () => {
    // given: waits are held until released, so the view can be read mid-wait
    const held: Array<() => void> = []
    let changes = 0
    const { guard } = setup([OFF, ON], {
      schedule: (fn) => {
        held.push(fn)
        return () => undefined
      },
      onChange: () => { changes += 1 },
    })

    // when
    guard.event(sessionError(NETWORK_ERROR))
    await settle()

    // then
    expect(guard.snapshot()).toEqual([
      { sessionID: MAIN, phase: "offline", attempt: 1, since: 1_000_000, verdict: "offline", nextAt: 1_005_000, limit: 12 },
    ])
    expect(changes).toBeGreaterThanOrEqual(2)

    // when the network returns
    const before = changes
    held.shift()?.()
    await settle()

    // then
    expect(guard.snapshot()).toEqual([])
    expect(changes).toBeGreaterThan(before)
    guard.dispose()
  })

  test("OpenCode's own retry shows its attempt and next time until the session goes idle", async () => {
    let changes = 0
    const { guard } = setup([OFF], { onChange: () => { changes += 1 } })
    guard.event(event("session.status", { sessionID: MAIN, status: { type: "retry", attempt: 2, message: "fetch failed", next: 1_004_000 } }))
    expect(guard.snapshot()).toEqual([{ sessionID: MAIN, phase: "retrying", attempt: 2, nextAt: 1_004_000, since: 1_000_000, limit: 12 }])
    expect(changes).toBe(1)
    guard.event(event("session.idle", { sessionID: MAIN }))
    expect(guard.snapshot()).toEqual([])
    expect(changes).toBe(2)
    guard.dispose()
  })

  test("a busy session after a freeze is shown until its stream resumes; unrelated events do not notify", async () => {
    let changes = 0
    const { guard } = setup([ON], { onChange: () => { changes += 1 } })
    guard.event(busy())
    guard.afterFreeze([MAIN], 30)
    await settle()
    expect(guard.snapshot()).toEqual([{ sessionID: MAIN, phase: "online", limit: 12, frozenSeconds: 30 }])
    expect(changes).toBe(1)
    guard.event(event("message.part.delta", { sessionID: MAIN }))
    expect(guard.snapshot()).toEqual([])
    guard.event(event("message.part.delta", { sessionID: MAIN }))
    expect(changes).toBe(2)
    guard.dispose()
  })
})

describe("stepAsideForNetwork", () => {
  test("network errors make the fallback paths step aside and reach the guard", async () => {
    // given
    const { guard, calls } = setup([ON])
    setNetworkGuard(guard)

    // then
    expect(getNetworkGuard()).toBe(guard)
    expect(stepAsideForNetwork(MAIN, NETWORK_ERROR, true)).toBe(true)
    await settle()
    expect(calls.continued).toHaveLength(1)
    expect(stepAsideForNetwork(MAIN, { message: "Too Many Requests", statusCode: 429 }, true)).toBe(false)
    guard.dispose()
  })

  test("without a running guard (creation failed) the fallback path keeps the error", () => {
    expect(stepAsideForNetwork(MAIN, "fetch failed", false)).toBe(false)
  })

  test("resilience disabled restores the old fallback behaviour", () => {
    setNetworkResilienceEnabled(false)
    expect(stepAsideForNetwork(MAIN, "fetch failed", true)).toBe(false)
  })
})

describe("review fixes (fork 0.15)", () => {
  const retry = (message = "Connection reset by server", next = 1_002_000) =>
    event("session.status", { sessionID: MAIN, status: { type: "retry", attempt: 1, message, next } })
  const delta = () => event("message.part.delta", { sessionID: MAIN, delta: "x" })

  describe("OpenCode's retry never exempts a session forever", () => {
    test("the next attempt going busy and then hanging is checked like any silent stream", async () => {
      // given
      const { guard, calls, advance } = setup([OFF, ON])
      guard.event(busy())
      guard.event(retry())
      expect(guard.isWaiting(MAIN)).toBe(true)

      // when: OpenCode's next attempt starts and hangs without a word
      advance(2_000)
      guard.event(busy())
      advance(10 * 60_000)
      await guard.tick()
      await settle()

      // then
      expect(guard.isWaiting(MAIN)).toBe(false)
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued).toHaveLength(1)
      guard.dispose()
    })

    test("a retry that never reports back stops being a wait after its next attempt plus the silent window", async () => {
      const { guard, calls, advance } = setup([OFF, ON])
      guard.event(busy())
      guard.event(retry())
      advance(2_000 + 60_000 + 1)
      expect(guard.isWaiting(MAIN)).toBe(false)
      expect(guard.snapshot()).toEqual([])
      await guard.tick()
      await settle()
      expect(calls.continued).toHaveLength(1)
      guard.dispose()
    })

    test("a later retry that is not a network error leaves the network wait", () => {
      const { guard } = setup([ON])
      guard.event(retry())
      guard.event(retry("Rate limit exceeded"))
      expect(guard.isWaiting(MAIN)).toBe(false)
      guard.dispose()
    })
  })

  describe("a provider whose transport fails while the network works", () => {
    test("after two continuations with no model data it hands off and charges the shared budget", async () => {
      // given: no provider URL, the neutral site answers
      const charged: string[] = []
      const { guard, calls } = setup([ON], {
        providerProbeUrl: async () => undefined,
        chargeBudget: (sessionID) => { charged.push(sessionID); return { used: 1, max: 3, exhausted: false } },
      })

      // when: every continuation fails the same way
      for (let i = 0; i < 4; i++) {
        guard.event(sessionError({ name: "UnknownError", data: { message: "Connection refused" } }))
        await settle()
      }

      // then
      expect(calls.continued).toHaveLength(3)
      expect(calls.handedOff).toEqual([MAIN])
      expect(charged).toEqual([MAIN])
      guard.dispose()
    })

    test("model data between the cuts keeps it on the same model", async () => {
      const { guard, calls } = setup([ON], { providerProbeUrl: async () => undefined })
      for (let i = 0; i < 4; i++) {
        guard.event(sessionError(NETWORK_ERROR))
        await settle()
        guard.event(delta())
      }
      expect(calls.continued).toHaveLength(4)
      expect(calls.handedOff).toEqual([])
      guard.dispose()
    })

    test("with the budget spent the work is saved instead of switching models", async () => {
      const { guard, calls } = setup([ON], {
        providerProbeUrl: async () => undefined,
        chargeBudget: () => ({ used: 3, max: 3, exhausted: true }),
      })
      for (let i = 0; i < 3; i++) {
        guard.event(sessionError(NETWORK_ERROR))
        await settle()
      }
      expect(calls.handedOff).toEqual([])
      expect(calls.interrupted).toHaveLength(1)
      expect(calls.interrupted[0]?.detail).toContain("retry budget spent (3/3)")
      guard.dispose()
    })
  })

  describe("a network change under a busy session", () => {
    test("the silent stream is resumed on the same model even though the new link is already up", async () => {
      // given: the address fingerprint changes while the session waits for the model
      let addresses = "wlan0/192.168.1.5"
      const { guard, calls, advance } = setup([ON], { networkFingerprint: () => addresses })
      guard.event(busy())
      advance(10_000)
      addresses = "eth0/10.0.0.7"
      await guard.tick()

      // when: the stream stays silent for the silent window
      advance(50_001)
      await guard.tick()
      await settle()

      // then
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued).toEqual([{ sessionID: MAIN, text: networkChangedText }])
      expect(calls.handedOff).toEqual([])
      guard.dispose()
    })

    test("the stall watchdog's late check is taken over (same model, no budget) after a change it did not see", async () => {
      // given: the link monitor runs while the session is busy and reports the switch
      let onChange: (() => void) | undefined
      let addresses = "wlan0/192.168.1.5"
      const { guard, calls, advance } = setup([ON], {
        networkFingerprint: () => addresses,
        watchLink: (callback) => {
          onChange = callback
          return { stop: () => { onChange = undefined } }
        },
      })
      guard.event(busy())
      expect(onChange).toBeDefined()
      advance(5_000)
      addresses = "wwan0/100.64.0.9"
      onChange?.()

      // when
      advance(235_000)
      const taken = await guard.takeOverStall(MAIN, { stopped: false })

      // then
      expect(taken).toBe(true)
      expect(calls.aborted).toEqual([MAIN])
      expect(calls.continued[0]?.text).toBe(networkChangedText)
      guard.event(event("session.idle", { sessionID: MAIN }))
      expect(onChange).toBeUndefined()
      guard.dispose()
    })

    test("a monitor event with the same addresses is not a change", async () => {
      let onChange: (() => void) | undefined
      const { guard, advance } = setup([ON], {
        networkFingerprint: () => "wlan0/192.168.1.5",
        watchLink: (callback) => {
          onChange = callback
          return { stop: () => undefined }
        },
      })
      guard.event(busy())
      advance(5_000)
      onChange?.()
      advance(235_000)
      expect(await guard.takeOverStall(MAIN, { stopped: false })).toBe(false)
      guard.dispose()
    })
  })

  describe("the user takes over during a wait", () => {
    test("a message typed while offline: no \"Connection restored\" continuation", async () => {
      // given
      const held: Array<() => void> = []
      const { guard, calls, advance } = setup([OFF, ON], { schedule: (fn) => { held.push(fn); return () => undefined } })
      guard.event(sessionError(NETWORK_ERROR))
      await settle()

      // when
      advance(1_000)
      guard.event(event("message.updated", { info: { sessionID: MAIN, id: "msg_user", role: "user" } }))
      held.shift()?.()
      await settle()

      // then
      expect(calls.continued).toEqual([])
      expect(guard.isWaiting(MAIN)).toBe(false)
      guard.dispose()
    })

    test("Esc while offline: no continuation", async () => {
      const held: Array<() => void> = []
      const { guard, calls, advance } = setup([OFF, ON], { schedule: (fn) => { held.push(fn); return () => undefined } })
      guard.event(sessionError(NETWORK_ERROR))
      await settle()
      advance(1_000)
      guard.event(sessionError({ name: "MessageAbortedError", data: { message: "Aborted" } }))
      held.shift()?.()
      await settle()
      expect(calls.continued).toEqual([])
      guard.dispose()
    })

    test("the user's message failing on the network again is continued when the network returns", async () => {
      const held: Array<() => void> = []
      const { guard, calls, advance } = setup([OFF, ON], { schedule: (fn) => { held.push(fn); return () => undefined } })
      guard.event(sessionError(NETWORK_ERROR))
      await settle()
      advance(1_000)
      guard.event(event("message.updated", { info: { sessionID: MAIN, id: "msg_user", role: "user" } }))
      advance(1_000)
      guard.event(sessionError(NETWORK_ERROR))
      held.shift()?.()
      await settle()
      expect(calls.continued).toHaveLength(1)
      guard.dispose()
    })
  })

  test("a later update of an errored assistant message already handled starts no new cycle", async () => {
    const { guard, calls } = setup([ON])
    const errored = { info: { sessionID: MAIN, id: "msg_a", role: "assistant", error: NETWORK_ERROR } }
    guard.event(event("message.updated", errored))
    await settle()
    guard.event(event("message.updated", { info: { ...errored.info, time: { completed: 1 } } }))
    await settle()
    expect(calls.continued).toHaveLength(1)
    guard.dispose()
  })

  test("idle sessions with nothing pending are dropped after 30 min", async () => {
    const { guard, advance } = setup([ON])
    guard.event(busy())
    guard.event(event("session.idle", { sessionID: MAIN }))
    guard.event(busy("ses_other"))
    advance(30 * 60_000 + 1)
    await guard.tick()
    expect(guard.trackedSessions()).toBe(1)
    guard.dispose()
  })

  test("the freeze mark ends with the turn: a later turn is not shown as frozen", async () => {
    const { guard } = setup([ON])
    guard.event(busy())
    guard.afterFreeze([MAIN], 30)
    await settle()
    guard.event(event("session.idle", { sessionID: MAIN }))
    guard.event(busy())
    expect(guard.snapshot()).toEqual([])
    guard.dispose()
  })
})
