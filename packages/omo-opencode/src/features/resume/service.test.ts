import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResumeService } from "./service"
import { listPaused } from "./store"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function service(overrides: { active?: string[]; rss?: number; owns?: (sessionID: string) => Promise<boolean>; logs?: string[] } = {}) {
  dir = mkdtempSync(join(tmpdir(), "resume-service-"))
  const toasts: string[] = []
  const created = createResumeService({
    ...(overrides.owns ? { ownsSession: overrides.owns } : {}),
    ...(overrides.logs ? { log: (message: string) => void overrides.logs?.push(message) } : {}),
    projectDir: dir,
    openReader: async () => null,
    target: async () => ({ agent: "Sisyphus - ultraworker" }),
    toast: async (message) => { toasts.push(message) },
    activeSessions: () => overrides.active ?? ["ses_main"],
    memory: { processLimitBytes: 1000, systemUsedRatio: 0.85, intervalMs: 60_000, sample: () => ({ rss: overrides.rss ?? 10, systemUsedRatio: 0.2 }) },
  })
  return { created, toasts }
}

describe("resume service (fork 0.8c)", () => {
  test("pause, list and resume: a resumed card is no longer listed and the prompt carries it", async () => {
    const { created } = service()
    await created.pause("ses_main", "the model stalled 3 times")
    expect(created.resume()).toContain("run_ses_main")
    const prompt = created.resume("run_ses_main", "try the other model")
    expect(prompt).toContain("[resume run_ses_main]")
    expect(prompt).toContain("try the other model")
    expect(listPaused(dir)).toEqual([])
    expect(created.resume()).toContain("No paused work")
  })

  test("memory over the limit saves every active session and warns the user once", async () => {
    const { created, toasts } = service({ active: ["s1", "s2"], rss: 5000 })
    await created.checkMemory()
    await created.checkMemory()
    expect(listPaused(dir).map((card) => card.sessionID).sort()).toEqual(["s1", "s2"])
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toContain("/omo-resume")
  })

  test("an unknown id is explained", () => {
    const { created } = service()
    expect(created.resume("run_nope")).toContain("ERROR")
  })

  test("on shutdown only working sessions get a card", async () => {
    const { created } = service({ active: ["busy1"] })
    await created.saveOnShutdown()
    expect(listPaused(dir).map((card) => card.sessionID)).toEqual(["busy1"])
    expect(listPaused(dir)[0]?.reason).toContain("closed while working")
  })

  test("with several OpenCode instances in one process, each saves only the sessions of its own folder (bench 19-10-2026)", async () => {
    const { created } = service({ active: ["mine", "other-project"], owns: async (sessionID) => sessionID === "mine" })
    expect(await created.pauseActive("memory high")).toBe(1)
    expect(listPaused(dir).map((card) => card.sessionID)).toEqual(["mine"])
  })

  test("an instance whose project folder was deleted saves nothing and says why, once (bench 19-10-2026)", async () => {
    const logs: string[] = []
    const { created } = service({ active: ["s1"], logs })
    rmSync(dir, { recursive: true, force: true })
    expect(await created.pauseActive("memory high")).toBe(0)
    expect(await created.pauseActive("memory high")).toBe(0)
    expect(logs.filter((line) => line.includes("project folder is gone"))).toHaveLength(1)
    expect(logs.some((line) => line.includes("pause failed"))).toBe(false)
  })
})

