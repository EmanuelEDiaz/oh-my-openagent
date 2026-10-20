import { describe, expect, test } from "bun:test"

import { sessionTreeBusy } from "./session-tree"

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
