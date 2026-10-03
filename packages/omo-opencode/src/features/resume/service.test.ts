import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResumeService } from "./service"
import { listPaused } from "./store"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function service(overrides: { active?: string[]; rss?: number } = {}) {
  dir = mkdtempSync(join(tmpdir(), "resume-service-"))
  const toasts: string[] = []
  const created = createResumeService({
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
})
