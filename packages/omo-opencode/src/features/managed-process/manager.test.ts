import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createProcessManager, type ProcessManagerDeps, type SpawnedChild } from "./manager"

type FakeChild = SpawnedChild & { write(line: string): void; exit(code: number): void }

function fakeChild(pid: number): FakeChild {
  let out!: ReadableStreamDefaultController<Uint8Array>
  let err!: ReadableStreamDefaultController<Uint8Array>
  let resolveExit!: (code: number) => void
  const encoder = new TextEncoder()
  return {
    pid,
    stdout: new ReadableStream<Uint8Array>({ start: (controller) => { out = controller } }),
    stderr: new ReadableStream<Uint8Array>({ start: (controller) => { err = controller } }),
    exited: new Promise<number>((resolve) => { resolveExit = resolve }),
    write: (line) => out.enqueue(encoder.encode(`${line}\n`)),
    exit: (code) => { out.close(); err.close(); resolveExit(code) },
  }
}

let dir = ""
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

function setup(overrides: Partial<ProcessManagerDeps> = {}) {
  dir = mkdtempSync(join(tmpdir(), "managed-process-"))
  const children: FakeChild[] = []
  const notes: Array<{ sessionID: string; text: string }> = []
  const toasts: string[] = []
  const timers: Array<{ fn: () => void; ms: number }> = []
  const spawned: string[][] = []
  const deps: ProcessManagerDeps = {
    stateDir: dir,
    shell: (command) => ["/bin/sh", "-c", command],
    spawn: (argv) => { spawned.push([...argv]); const child = fakeChild(1000 + children.length); children.push(child); return child },
    terminate: async () => ({ survivorPids: [] }),
    notify: async (sessionID, text) => { notes.push({ sessionID, text }) },
    toast: async (text) => { toasts.push(text) },
    isPortOpen: async () => false,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); if (ms === 2000) setTimeout(fn, 1); return timers.length },
    clearTimer: () => {},
    portPollMs: 1000,
    platform: "linux",
    ...overrides,
  }
  return { manager: createProcessManager(deps), children, notes, toasts, timers, spawned }
}

const flush = () => Bun.sleep(5)

describe("managed processes (fork 0.8b)", () => {
  test("runs through the shell, logs output and tells the agent once when it exits", async () => {
    const { manager, children, notes, spawned } = setup()
    const record = await manager.start({ sessionID: "s1", name: "deps", command: "npm i && echo ok", cwd: "/w" })
    expect(spawned[0]).toEqual(["/bin/sh", "-c", "npm i && echo ok"])
    children[0]!.write("added 12 packages")
    children[0]!.exit(0)
    await flush()

    expect(manager.status(record.id)?.status).toBe("exited")
    expect(manager.status(record.id)?.exitCode).toBe(0)
    expect(notes).toHaveLength(1)
    expect(notes[0]!.text).toContain("deps")
    expect(notes[0]!.text).toContain("exit code 0")
    expect(notes[0]!.text).toContain("added 12 packages")
    expect(readFileSync(record.logPath, "utf8")).toContain("added 12 packages")
    expect(manager.logs(record.id, 10)).toEqual(["added 12 packages"])
  })

  test("wait_for a pattern: told once when the line appears, then again only if it dies", async () => {
    const { manager, children, notes } = setup()
    await manager.start({ sessionID: "s1", name: "web", command: "npm run dev", waitFor: { pattern: "ready on" } })
    children[0]!.write("compiling")
    await flush()
    expect(notes).toHaveLength(0)
    expect(manager.isWaiting("s1")).toBe(true)
    children[0]!.write("ready on http://localhost:3000")
    await flush()
    expect(notes).toHaveLength(1)
    expect(notes[0]!.text).toContain("ready")
    expect(manager.isWaiting("s1")).toBe(false)
    children[0]!.exit(1)
    await flush()
    expect(notes).toHaveLength(2)
    expect(notes[1]!.text).toContain("exit code 1")
  })

  test("wait_for a port: told when it opens", async () => {
    let open = false
    const { manager, notes, timers } = setup({ isPortOpen: async () => open })
    await manager.start({ sessionID: "s1", name: "api", command: "serve", waitFor: { port: 8080 } })
    timers.find((timer) => timer.ms === 1000)!.fn()
    await flush()
    expect(notes).toHaveLength(0)
    open = true
    timers.filter((timer) => timer.ms === 1000).at(-1)!.fn()
    await flush()
    expect(notes[0]!.text).toContain("8080")
  })

  test("past its time limit it warns the user and the agent but never kills", async () => {
    let terminated = false
    const { manager, notes, toasts, timers } = setup({ terminate: async () => { terminated = true; return { survivorPids: [] } } })
    const record = await manager.start({ sessionID: "s1", name: "build", command: "make", timeoutMs: 7_200_000 })
    timers.find((timer) => timer.ms === 7_200_000)!.fn()
    await flush()
    expect(terminated).toBe(false)
    expect(manager.status(record.id)?.status).toBe("running")
    expect(toasts[0]).toContain("build")
    expect(notes[0]!.text).toContain("still running")
  })

  test("stop reports stopped only when nothing survives, otherwise the exact command to kill it by hand", async () => {
    const ok = setup()
    const first = await ok.manager.start({ sessionID: "s1", name: "a", command: "x" })
    expect((await ok.manager.stop(first.id)).status).toBe("stopped")

    const bad = setup({ terminate: async () => ({ survivorPids: [4242] }) })
    const second = await bad.manager.start({ sessionID: "s1", name: "b", command: "x" })
    const result = await bad.manager.stop(second.id)
    expect(result.status).toBe("stop_failed")
    expect(result.manualCommand).toBe("kill -9 4242")

    const win = setup({ platform: "win32", terminate: async () => ({ survivorPids: [77] }) })
    const third = await win.manager.start({ sessionID: "s1", name: "c", command: "x" })
    expect((await win.manager.stop(third.id)).manualCommand).toBe("taskkill /PID 77 /T /F")
  })

  test("keeps a registry on disk and shutdown stops everything except keep_alive", async () => {
    const stopped: number[] = []
    const { manager } = setup({ terminate: async (pid) => { stopped.push(pid); return { survivorPids: [] } } })
    await manager.start({ sessionID: "s1", name: "tmp", command: "x" })
    await manager.start({ sessionID: "s1", name: "db", command: "y", keepAlive: true })
    const registry = JSON.parse(readFileSync(join(dir, "processes.json"), "utf8")) as Array<{ name: string; pid: number }>
    expect(registry.map((entry) => entry.name)).toEqual(["tmp", "db"])
    await manager.shutdown()
    expect(stopped).toEqual([1000])
  })

  test("lists only the session's processes", async () => {
    const { manager } = setup()
    await manager.start({ sessionID: "s1", name: "a", command: "x" })
    await manager.start({ sessionID: "s2", name: "b", command: "y" })
    expect(manager.list("s1").map((record) => record.name)).toEqual(["a"])
  })

  test("a grandchild holding the pipes open does not block the exit notice", async () => {
    const { manager, notes } = setup({
      spawn: () => ({ pid: 9, stdout: new ReadableStream({ start: () => {} }), stderr: new ReadableStream({ start: () => {} }), exited: Promise.resolve(0) }),
    })
    await manager.start({ sessionID: "s1", name: "x", command: "x" })
    await Bun.sleep(20)
    expect(notes[0]?.text).toContain("exit code 0")
  })

  test("when a session ends its processes stop, except keep_alive", async () => {
    const stopped: number[] = []
    const { manager } = setup({ terminate: async (pid) => { stopped.push(pid); return { survivorPids: [] } } })
    await manager.start({ sessionID: "s1", name: "a", command: "x" })
    await manager.start({ sessionID: "s1", name: "b", command: "y", keepAlive: true })
    await manager.start({ sessionID: "s2", name: "c", command: "z" })
    await manager.stopSession("s1")
    expect(stopped).toEqual([1000])
  })
})
