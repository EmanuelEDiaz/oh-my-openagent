import { describe, expect, test } from "bun:test"

import { createManagedProcessGuardHook } from "./hook"

const run = (enforce: boolean, tool: string, command: string) =>
  createManagedProcessGuardHook({ enforceLongRunning: enforce })["tool.execute.before"]!(
    { tool, sessionID: "s", callID: "c" } as never,
    { args: { command } } as never,
  )

describe("managed process guard hook (fork 0.8b)", () => {
  test("blocks long-running bash commands with the process_start alternative", async () => {
    await expect(run(true, "bash", "npm install")).rejects.toThrow("process_start")
  })

  test("blocks self-kill even when long-running enforcement is off", async () => {
    await expect(run(false, "bash", "pkill -f server")).rejects.toThrow("Blocked")
    await expect(run(false, "bash", "npm install")).resolves.toBeUndefined()
  })

  // H46: process_start runs its command itself, so OpenCode's bash rules and this guard never saw it.
  test("checks process_start commands for root and self-kill, but not for long-running", async () => {
    await expect(run(true, "process_start", "sudo -n systemctl start docker")).rejects.toThrow("root")
    await expect(run(true, "process_start", "pkill -f server")).rejects.toThrow("Blocked")
    await expect(run(true, "process_start", "npm install")).resolves.toBeUndefined()
  })

  test("blocks root commands even when long-running enforcement is off", async () => {
    await expect(run(false, "bash", "sudo systemctl start docker")).rejects.toThrow("root")
  })

  test("ignores other tools and normal commands", async () => {
    await expect(run(true, "read", "npm install")).resolves.toBeUndefined()
    await expect(run(true, "bash", "npm test")).resolves.toBeUndefined()
  })
})

describe("a blocked identity cannot move into a script (fork incident H50)", () => {
  test("a script run from bash is checked with its text", async () => {
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const dir = mkdtempSync(join(tmpdir(), "guard-hook-"))
    writeFileSync(join(dir, "c.sh"), "GIT_AUTHOR_NAME=Robot git commit -m x\n")
    const hook = createManagedProcessGuardHook({ enforceLongRunning: true, directory: dir })
    await expect(hook["tool.execute.before"]!({ tool: "bash", sessionID: "s", callID: "c" } as never, { args: { command: "sh c.sh" } } as never)).rejects.toThrow("git identity")
    rmSync(dir, { recursive: true, force: true })
  })
})
