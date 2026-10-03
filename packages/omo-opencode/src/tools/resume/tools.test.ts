import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createResumeService } from "../../features/resume/service"
import { createHandoffTools, createResumeTools } from "./tools"

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

describe("handoff_save + resume_task (fork 0.8c)", () => {
  test("a saved handoff is listed and its summary comes back on resume", async () => {
    dir = mkdtempSync(join(tmpdir(), "handoff-"))
    const service = createResumeService({ projectDir: dir, openReader: async () => null, target: async () => ({}), toast: async () => {}, activeSessions: () => [] })
    const context = { sessionID: "ses_h" } as never
    const saved = String(await createHandoffTools(service).handoff_save.execute({ summary: "GOAL: finish the login page\nPENDING: tests" } as never, context))
    expect(saved).toContain("run_ses_h")
    const tools = createResumeTools(service)
    expect(String(await tools.resume_task.execute({} as never, context))).toContain("handoff created by the user")
    expect(String(await tools.resume_task.execute({ id: "run_ses_h" } as never, context))).toContain("GOAL: finish the login page")
  })
})
