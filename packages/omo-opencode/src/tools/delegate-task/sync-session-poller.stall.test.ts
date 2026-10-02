import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { createStallWatchdog } from "../../features/stall-watchdog/watchdog"
import { setStallWatchdog } from "../../features/stall-watchdog"
import { shouldRetryError } from "../../shared/model-error-classifier"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import { pollSyncSession } from "./sync-session-poller"

describe("sync delegation stops a stalled subagent (fork 0.8a)", () => {
  beforeEach(() => {
    __setTimingConfig({ POLL_INTERVAL_MS: 5, MIN_STABILITY_TIME_MS: 0, STABILITY_POLLS_REQUIRED: 1, MAX_POLL_TIME_MS: 60_000 })
  })
  afterEach(() => {
    __resetTimingConfig()
    setStallWatchdog(undefined)
  })

  test("a session the watchdog marked stalled is aborted and reported as a retryable stall", async () => {
    // given
    let now = 0
    const watchdog = createStallWatchdog({ inactivityMs: 1000, now: () => now })
    watchdog.observe({ type: "session.status", properties: { sessionID: "ses_child", status: { type: "busy" } } })
    now = 5000
    watchdog.findStalled()
    setStallWatchdog(watchdog)
    const aborted: string[] = []
    const client = {
      session: {
        status: async () => ({ data: { ses_child: { type: "busy" } } }),
        messages: async () => ({ data: [] }),
        abort: async ({ path }: { path: { id: string } }) => { aborted.push(path.id); return {} },
      },
    }

    // when
    const result = await pollSyncSession(
      { sessionID: "parent", messageID: "m", agent: "a", abort: new AbortController().signal } as never,
      client as never,
      { sessionID: "ses_child", agentToUse: "explore", toastManager: null, taskId: undefined },
    )

    // then
    expect(result).toContain("stalled")
    expect(shouldRetryError({ message: result ?? "" })).toBe(true)
    await Bun.sleep(5)
    expect(aborted).toEqual(["ses_child"])
  })
})
