import { describe, expect, test } from "bun:test"

import { createStallDetector, progressSignature } from "./progress"
import { classifyFailure } from "./score"

describe("stall detection", () => {
  test("a session that changes nothing for the stall window is stalled", () => {
    let now = 0
    const detector = createStallDetector(240_000, () => now)
    expect(detector.stalled("a")).toBe(false)
    now = 200_000
    expect(detector.stalled("a")).toBe(false)
    now = 241_000
    expect(detector.stalled("a")).toBe(true)
  })

  test("any progress resets the window", () => {
    let now = 0
    const detector = createStallDetector(240_000, () => now)
    detector.stalled("a")
    now = 200_000
    expect(detector.stalled("b")).toBe(false)
    now = 400_000
    expect(detector.stalled("b")).toBe(false)
  })

  test("the signature changes with new messages, parts and tool status", () => {
    const base = [{ info: { role: "assistant" }, parts: [{ type: "tool", state: { status: "running" } }] }]
    const done = [{ info: { role: "assistant" }, parts: [{ type: "tool", state: { status: "completed" } }] }]
    expect(progressSignature(base)).not.toBe(progressSignature(done))
    expect(progressSignature(done)).not.toBe(progressSignature([...done, { info: { role: "assistant" }, parts: [] }]))
  })

  test("a stalled run is infrastructure, not the agent's fault", () => {
    expect(classifyFailure("explore/x stalled: no progress for 240s")).toBe("infra")
  })
})
