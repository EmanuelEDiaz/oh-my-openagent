import { describe, expect, test } from "bun:test"

import { reportWorkStopped } from "./work-stopped"

describe("reportWorkStopped (fork 0.8c)", () => {
  test("saves the work and tells the user how to resume", async () => {
    const calls: string[] = []
    await reportWorkStopped("ses_1", "no tool progress after 3 continuations", {
      toast: async (message) => { calls.push(`toast: ${message}`) },
      pause: async (id, reason) => { calls.push(`pause: ${id} ${reason}`) },
    })
    expect(calls[0]).toBe("pause: ses_1 no tool progress after 3 continuations")
    expect(calls[1]).toContain("reanuda")
  })

  test("a failing pause still warns the user", async () => {
    const calls: string[] = []
    await reportWorkStopped("s", "r", { toast: async (m) => { calls.push(m) }, pause: async () => { throw new Error("x") } })
    expect(calls).toHaveLength(1)
  })
})
