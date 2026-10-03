import { describe, expect, test } from "bun:test"

import { createMemoryWatch, parseMemAvailable } from "./memory-watch"

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
})
