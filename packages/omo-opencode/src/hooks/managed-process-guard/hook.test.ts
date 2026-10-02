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

  test("ignores other tools and normal commands", async () => {
    await expect(run(true, "read", "npm install")).resolves.toBeUndefined()
    await expect(run(true, "bash", "npm test")).resolves.toBeUndefined()
  })
})
