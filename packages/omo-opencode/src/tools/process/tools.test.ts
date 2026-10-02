import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProcessManager } from "../../features/managed-process/manager"
import { createProcessTools } from "./tools"

function setup(ask?: (input: { patterns: string[] }) => Promise<void>) {
  const manager = createProcessManager({
    stateDir: mkdtempSync(join(tmpdir(), "process-tools-")),
    shell: (command) => ["sh", "-c", command],
    spawn: () => ({ pid: 42, stdout: new ReadableStream(), stderr: new ReadableStream(), exited: new Promise(() => {}) }),
    terminate: async () => ({ survivorPids: [] }),
    notify: async () => {},
    toast: async () => {},
    isPortOpen: async () => false,
    setTimer: () => 0,
    clearTimer: () => {},
  })
  const tools = createProcessTools(manager)
  const context = { sessionID: "s1", messageID: "m", agent: "a", abort: new AbortController().signal, directory: "/w", ...(ask ? { ask } : {}) }
  return { tools, manager, context }
}

describe("process tools (fork 0.8b)", () => {
  test("process_start runs only what the agent's bash permission allows", async () => {
    const denied = setup(async () => { throw new Error("bash denied for this agent") })
    const refused = await denied.tools.process_start.execute({ name: "x", command: "rm -rf /" } as never, denied.context as never)
    expect(String(refused)).toContain("denied")
    expect(denied.manager.list("s1")).toHaveLength(0)

    const allowed = setup(async () => {})
    const started = await allowed.tools.process_start.execute({ name: "deps", command: "npm install", wait_for: "exit" } as never, allowed.context as never)
    expect(String(started)).toContain("proc_")
    expect(String(started)).toContain("you will be told")
    expect(allowed.manager.list("s1")[0]?.cwd).toBe("/w")
  })

  test("status, logs, list and stop work on the session's processes", async () => {
    const { tools, context } = setup(async () => {})
    const started = String(await tools.process_start.execute({ name: "web", command: "npm run dev", wait_for: { port: 3000 } } as never, context as never))
    const id = /proc_\w+/.exec(started)![0]
    expect(String(await tools.process_status.execute({ id } as never, context as never))).toContain("running")
    expect(String(await tools.process_list.execute({} as never, context as never))).toContain("web")
    expect(String(await tools.process_logs.execute({ id } as never, context as never))).toContain("no output")
    expect(String(await tools.process_stop.execute({ id } as never, context as never))).toContain("stopped")
  })

  test("unknown ids and invalid wait_for are explained, not thrown", async () => {
    const { tools, context } = setup(async () => {})
    expect(String(await tools.process_status.execute({ id: "proc_nope" } as never, context as never))).toContain("unknown")
    expect(String(await tools.process_start.execute({ name: "x", command: "y", wait_for: { port: 99999 } } as never, context as never))).toContain("ERROR")
  })
})
