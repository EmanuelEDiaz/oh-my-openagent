import { afterEach, describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"
import type { LoopBreaker } from "../features/loop-breaker/breaker"
import { getActiveLoopBreaker, setActiveLoopBreaker } from "../features/loop-breaker/plugin"
import { getNetworkGuard, setNetworkGuard, type NetworkGuard } from "../features/network-guard"
import { getTaskToastManager, initTaskToastManager, releaseTaskToastManager, _resetTaskToastManagerForTesting } from "../features/task-toast-manager/manager"
import { createPluginWebResearch, getActiveWebResearch, releasePluginWebResearch } from "../features/web-research/plugin"

// Fork incidents H13 (19-10-2026): one OpenCode server hosts several project folders, one plugin instance each.
// Every object below used to be a single module-level "current" that the newest instance overwrote.
afterEach(() => {
  setActiveLoopBreaker(undefined)
  setNetworkGuard(undefined)
  _resetTaskToastManagerForTesting()
  releasePluginWebResearch("/a")
  releasePluginWebResearch("/b")
})

describe("one object per project folder in a shared OpenCode server", () => {
  test("#given two folders #then each reads its own loop breaker, network guard, toast manager and web research", () => {
    const breakerA = unsafeTestValue<LoopBreaker>({ id: "A" })
    const breakerB = unsafeTestValue<LoopBreaker>({ id: "B" })
    setActiveLoopBreaker(breakerA, "/a")
    setActiveLoopBreaker(breakerB, "/b")
    expect(getActiveLoopBreaker("/a")).toBe(breakerA)

    const guardA = unsafeTestValue<NetworkGuard>({ id: "A" })
    setNetworkGuard(guardA, "/a")
    setNetworkGuard(unsafeTestValue<NetworkGuard>({ id: "B" }), "/b")
    expect(getNetworkGuard("/a")).toBe(guardA)

    const toastA = initTaskToastManager(unsafeTestValue({}), undefined, "/a")
    initTaskToastManager(unsafeTestValue({}), undefined, "/b")
    expect(getTaskToastManager("/a")).toBe(toastA)

    const researchA = createPluginWebResearch(undefined, {}, "/a")
    createPluginWebResearch(undefined, {}, "/b")
    expect(getActiveWebResearch("/a")).toBe(researchA)
  })

  test("#given the newer folder's instance is disposed #then the older one's objects are still there", () => {
    const toastA = initTaskToastManager(unsafeTestValue({}), undefined, "/a")
    initTaskToastManager(unsafeTestValue({}), undefined, "/b")
    releaseTaskToastManager("/b")
    expect(getTaskToastManager("/a")).toBe(toastA)
    expect(getTaskToastManager()).toBe(toastA)

    const researchA = createPluginWebResearch(undefined, {}, "/a")
    createPluginWebResearch(undefined, {}, "/b")
    releasePluginWebResearch("/b")
    expect(getActiveWebResearch()).toBe(researchA)
  })
})
