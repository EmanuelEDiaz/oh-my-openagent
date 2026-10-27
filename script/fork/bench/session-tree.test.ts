import { describe, expect, test } from "bun:test"

import { quotaExhausted, sessionTreeBusy } from "./session-tree"

// Fork incidents H25 (20-10-2026): the main agent launched two background explores and went idle for 8 s waiting for
// them; the bench took 5 s of idle as "done", aborted it and graded a half-done task. The plugin woke it at 8 s.
const children: Record<string, string[]> = { root: ["explore-a", "explore-b"], "explore-a": ["nested"] }
const childrenOf = async (id: string) => children[id] ?? []

describe("sessionTreeBusy", () => {
  test("#given a subagent still working #then the tree is busy even though the main session is idle", async () => {
    expect(await sessionTreeBusy({ root: { type: "idle" }, "explore-b": { type: "busy" } }, childrenOf, "root")).toBe(true)
  })

  test("#given a nested subagent retrying #then the tree is busy", async () => {
    expect(await sessionTreeBusy({ nested: { type: "retry" } }, childrenOf, "root")).toBe(true)
  })

  test("#given every session idle or unknown #then the tree is not busy", async () => {
    expect(await sessionTreeBusy({ root: { type: "idle" }, "explore-a": { type: "idle" } }, childrenOf, "root")).toBe(false)
  })
})

describe("quotaExhausted", () => {
  const limit = "Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go"

  test("#given a session OpenCode keeps retrying on a spent quota #then the retry message is returned", () => {
    expect(quotaExhausted({ root: { type: "busy" }, child: { type: "retry", message: limit } })).toBe(limit)
  })

  test("#given the status OpenCode really shows on a spent free quota (27-10-2026) #then it is a quota stop, with the reset time", () => {
    const status = {
      type: "retry",
      message: "Free usage exceeded, subscribe to Go",
      action: { reason: "free_tier_limit", provider: "opencode", title: "Free limit reached" },
      next: Date.UTC(2026, 9, 28, 0, 0, 0),
    }
    expect(quotaExhausted({ ses: status })).toBe("Free usage exceeded, subscribe to Go (free_tier_limit; retry after 2026-10-28T00:00:00.000Z)")
  })

  test("#given idle, busy or a retry for another reason #then there is no quota stop", () => {
    expect(quotaExhausted({ root: { type: "idle" }, child: { type: "busy" } })).toBeUndefined()
    expect(quotaExhausted({ root: { type: "retry", message: "Provider is overloaded" } })).toBeUndefined()
    expect(quotaExhausted({})).toBeUndefined()
  })
})
