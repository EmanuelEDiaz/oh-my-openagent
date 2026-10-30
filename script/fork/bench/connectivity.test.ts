import { describe, expect, test } from "bun:test"

import { waitForConnection } from "./connectivity"

describe("waitForConnection", () => {
  test("#given the connection is back after two checks #then it waits and reports how long", async () => {
    // given
    let checks = 0
    const slept: number[] = []
    const reachable = async () => ++checks > 2

    // when
    const result = await waitForConnection({ reachable, sleep: async (ms) => void slept.push(ms), intervalMs: 15_000, maxWaitMs: 60_000 })

    // then
    expect(result).toEqual({ connected: true, waitedMs: 30_000 })
    expect(slept).toEqual([15_000, 15_000])
  })

  test("#given the connection is up #then it does not wait", async () => {
    const result = await waitForConnection({ reachable: async () => true, sleep: async () => {}, intervalMs: 15_000, maxWaitMs: 60_000 })
    expect(result).toEqual({ connected: true, waitedMs: 0 })
  })

  test("#given the connection never comes back #then it gives up at the limit", async () => {
    const result = await waitForConnection({ reachable: async () => false, sleep: async () => {}, intervalMs: 15_000, maxWaitMs: 45_000 })
    expect(result).toEqual({ connected: false, waitedMs: 45_000 })
  })

  test("#given the check itself throws #then it counts as no connection", async () => {
    let checks = 0
    const reachable = async () => {
      if (++checks === 1) throw new Error("getaddrinfo EAI_AGAIN")
      return true
    }
    const result = await waitForConnection({ reachable, sleep: async () => {}, intervalMs: 10, maxWaitMs: 100 })
    expect(result).toEqual({ connected: true, waitedMs: 10 })
  })
})
