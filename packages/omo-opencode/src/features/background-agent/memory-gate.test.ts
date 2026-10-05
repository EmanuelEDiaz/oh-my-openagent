import { describe, expect, test } from "bun:test"

import { createMemoryGate, WAITING_FOR_MEMORY_TOAST } from "./memory-gate"

const MB = 1024 ** 2

function setup(options: { available: number[]; running?: number; warning?: boolean; totalMb?: number }) {
  const toasts: string[] = []
  const samples = [...options.available]
  let current = samples[0]!
  let sleeps = 0
  let clock = 0
  const gate = createMemoryGate({
    lowMemoryMb: 700,
    lowMemoryRatio: 0.1,
    resumeMemoryMb: 900,
    sample: () => {
      current = samples.length > 1 ? samples.shift()! : samples[0]!
      return { rss: 0, systemUsedRatio: 0, availableBytes: current * MB, totalBytes: (options.totalMb ?? 4000) * MB }
    },
    runningCount: () => options.running ?? 1,
    toast: (message) => {
      toasts.push(message)
    },
    isMemoryWarningActive: () => options.warning ?? false,
    sleep: async () => {
      if (++sleeps > 50) throw new Error("gate never admitted")
      clock += 5000
    },
    now: () => clock,
  })
  return { gate, toasts, sleeps: () => sleeps }
}

describe("low-RAM subagent gate (fork 0.15 E)", () => {
  test("enough memory: admits at once without a toast", async () => {
    const { gate, toasts, sleeps } = setup({ available: [2000] })
    await gate.waitForMemory("bg_1")
    expect(sleeps()).toBe(0)
    expect(toasts).toEqual([])
  })

  test("low memory: waits, toasts once, and admits only from resume_memory_mb (hysteresis)", async () => {
    const { gate, toasts, sleeps } = setup({ available: [600, 750, 850, 950] })
    await gate.waitForMemory("bg_1")
    // 600 enters the low state; 750 and 850 are above 700 but below 900, so it keeps waiting; 950 admits.
    expect(sleeps()).toBe(3)
    expect(toasts).toEqual([WAITING_FOR_MEMORY_TOAST])
  })

  test("the ratio counts too, and leaving it needs the same margin", async () => {
    const { gate, sleeps } = setup({ available: [3000, 3300, 3450], totalMb: 32000 })
    await gate.waitForMemory("bg_1")
    expect(sleeps()).toBe(2)
  })

  test("with no subagent running one is let through (no deadlock), the next one waits", async () => {
    const { gate, sleeps } = setup({ available: [300], running: 0 })
    await gate.waitForMemory("bg_1")
    expect(sleeps()).toBe(0)
    // The first one has not shown up as running yet: the second waits (here until it is cancelled).
    await gate.waitForMemory("bg_2", () => sleeps() >= 3)
    expect(sleeps()).toBe(3)
  })

  test("stays quiet while the high-memory warning of 0.9b is on screen", async () => {
    const { gate, toasts } = setup({ available: [500, 1000], warning: true })
    await gate.waitForMemory("bg_1")
    expect(toasts).toEqual([])
  })

  test("a sample without available memory never blocks", async () => {
    const gate = createMemoryGate({ lowMemoryMb: 700, lowMemoryRatio: 0.1, resumeMemoryMb: 900, sample: () => ({ rss: 0, systemUsedRatio: 0.99 }), runningCount: () => 3, toast: () => undefined })
    await gate.waitForMemory("bg_1")
    expect(gate.isLow()).toBe(false)
  })
})
