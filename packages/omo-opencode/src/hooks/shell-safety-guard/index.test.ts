/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { createShellSafetyGuardHook } from "./index"

// Fork roadmap 0.21: the hook reads the real process table, so the process running the plugin (OpenCode in
// production, the test runner here), its parent and init can never be killed through bash.
const client = { session: { get: async () => ({ data: {} }) } }
const hook = createShellSafetyGuardHook({ client, directory: "/tmp/project" } as never)
const run = (command: string) => hook["tool.execute.before"]({ tool: "bash", sessionID: "s", callID: `c-${command}` }, { args: { command } })

describe("shell safety hook on the real process table", () => {
  test.each([`kill -9 ${process.pid}`, `kill ${process.ppid}`, "kill -TERM 1", "sudo pkill -f node", "fuser -k 3000/tcp"])("refuses %s", async (command) => {
    await expect(run(command)).rejects.toThrow("[shell-safety]")
  })

  test("normal commands pass", async () => {
    await expect(run("ls -la && git status")).resolves.toBeUndefined()
  })

  test("a destructive command asks first", async () => {
    await expect(run("docker compose down -v")).rejects.toThrow("Allow destructive command #")
  })
})
