import { describe, expect, test } from "bun:test"

import { createInstanceRegistry } from "./instance-registry"

describe("instance registry (fork incidents H13: one OpenCode server, several project folders)", () => {
  test("#given two instances #when each asks for its own folder #then each gets its own object", () => {
    const registry = createInstanceRegistry<string>()
    registry.register("/a", "watchdog A")
    registry.register("/b", "watchdog B")
    expect(registry.get("/a")).toBe("watchdog A")
    expect(registry.get("/b")).toBe("watchdog B")
  })

  test("#given a caller that does not know its folder #then it gets the most recent live instance (one instance: as before)", () => {
    const registry = createInstanceRegistry<string>()
    registry.register("/a", "A")
    registry.register("/b", "B")
    expect(registry.get()).toBe("B")
    expect(registry.get("/unknown")).toBe("B")
  })

  test("#given the older instance is disposed #then the live one keeps its object (the old dispose used to clear it)", () => {
    const registry = createInstanceRegistry<string>()
    const disposeA = registry.register("/a", "A")
    registry.register("/b", "B")
    disposeA()
    expect(registry.get("/b")).toBe("B")
    expect(registry.get()).toBe("B")
    expect(registry.get("/a")).toBe("B")
  })

  test("#given the newest instance is disposed #then the previous live one becomes the fallback", () => {
    const registry = createInstanceRegistry<string>()
    registry.register("/a", "A")
    const disposeB = registry.register("/b", "B")
    disposeB()
    expect(registry.get()).toBe("A")
  })

  test("#given a folder registered again #when the stale unregister runs #then it does not remove the new object", () => {
    const registry = createInstanceRegistry<string>()
    const disposeOld = registry.register("/a", "old")
    registry.register("/a", "new")
    disposeOld()
    expect(registry.get("/a")).toBe("new")
  })

  test("#given a process-wide signal (SIGTERM) #then every live instance can be reached", () => {
    const registry = createInstanceRegistry<string>()
    registry.register("/a", "A")
    const disposeB = registry.register("/b", "B")
    registry.register("/c", "C")
    disposeB()
    expect(registry.values()).toEqual(["A", "C"])
  })

  test("#given everything is disposed #then nothing is returned and the registry holds nothing", () => {
    const registry = createInstanceRegistry<string>()
    const dispose = registry.register("/a", "A")
    dispose()
    dispose()
    expect(registry.get()).toBeUndefined()
    expect(registry.size()).toBe(0)
  })
})
