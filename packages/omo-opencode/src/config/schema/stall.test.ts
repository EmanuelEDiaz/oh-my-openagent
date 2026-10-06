import { describe, expect, test } from "bun:test"

import { StallConfigSchema } from "./stall"

describe("StallConfigSchema (fork 0.8a)", () => {
  test("defaults match the approved design", () => {
    expect(StallConfigSchema.parse({})).toEqual({
      enabled: true,
      chunk_timeout_ms: 90_000,
      header_timeout_ms: 120_000,
      inactivity_ms: 240_000,
      check_interval_ms: 15_000,
      max_stalls_per_task: 2,
    })
  })

  test("chunk timeout can be disabled", () => {
    expect(StallConfigSchema.parse({ chunk_timeout_ms: false }).chunk_timeout_ms).toBe(false)
  })

  test("header timeout can be disabled", () => {
    expect(StallConfigSchema.parse({ header_timeout_ms: false }).header_timeout_ms).toBe(false)
  })
})
