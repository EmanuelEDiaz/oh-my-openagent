import { describe, expect, test } from "bun:test"

import { createMemoryWatch, parseMemAvailable, parsePressure, sampleMemory } from "./memory-watch"

const GB = 1024 ** 3

describe("memory watch (fork 0.8c)", () => {
  test("fires once when OpenCode passes 1.2 GB, and again only after it went back under", () => {
    let rss = 0.5 * GB
    const watch = createMemoryWatch({ processLimitBytes: 1.2 * GB, systemUsedRatio: 0.85, sample: () => ({ rss, systemUsedRatio: 0.5 }) })
    expect(watch.check()).toBeUndefined()
    rss = 1.3 * GB
    expect(watch.check()?.reason).toContain("1.3 GB")
    expect(watch.check()).toBeUndefined()
    rss = 0.8 * GB
    expect(watch.check()).toBeUndefined()
    rss = 1.25 * GB
    expect(watch.check()).toBeDefined()
  })

  test("fires when the system passes 85% used memory", () => {
    const watch = createMemoryWatch({ processLimitBytes: 1.2 * GB, systemUsedRatio: 0.85, sample: () => ({ rss: 0.3 * GB, systemUsedRatio: 0.9 }) })
    expect(watch.check()?.reason).toContain("90%")
  })

  test("reads MemAvailable on Linux (free memory alone ignores reclaimable cache)", () => {
    const meminfo = "MemTotal:        7812345 kB\nMemFree:          300000 kB\nMemAvailable:    1600000 kB\n"
    expect(parseMemAvailable(meminfo)).toBe(1_600_000 * 1024)
    expect(parseMemAvailable("nothing")).toBeUndefined()
  })

  test("reads PSI some/full avg10 (fork 0.15); missing lines stay undefined", () => {
    const psi = "some avg10=12.50 avg60=3.00 avg300=1.00 total=123\nfull avg10=4.25 avg60=1.00 avg300=0.50 total=45\n"
    expect(parsePressure(psi)).toEqual({ some: 12.5, full: 4.25 })
    expect(parsePressure("some avg10=1.00 avg60=0 avg300=0 total=0\n")).toEqual({ some: 1 })
    expect(parsePressure("")).toEqual({})
  })

  test("a real sample carries available and total memory", () => {
    const sample = sampleMemory()
    expect(sample.totalBytes).toBeGreaterThan(0)
    expect(sample.availableBytes).toBeGreaterThan(0)
  })

  test("isHigh follows the crossing state", () => {
    let ratio = 0.5
    const watch = createMemoryWatch({ processLimitBytes: 10 * GB, systemUsedRatio: 0.85, sample: () => ({ rss: 0, systemUsedRatio: ratio }) })
    watch.check()
    expect(watch.isHigh()).toBe(false)
    ratio = 0.9
    watch.check()
    expect(watch.isHigh()).toBe(true)
  })
})
