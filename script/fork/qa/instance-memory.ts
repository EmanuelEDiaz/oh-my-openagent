#!/usr/bin/env bun
/**
 * How much memory each OpenCode instance costs, with and without the plugin (finding of 19-10-2026: the bench server
 * reached 1.6 GB after 19 task folders, one OpenCode instance each, never disposed). No model is called: an instance
 * starts when a request names a new directory, and that alone loads the plugin.
 *
 *   bun script/fork/qa/instance-memory.ts --plugin dist-x/index.js [--instances 12] [--evidence .omo/evidence/x]
 *   bun script/fork/qa/instance-memory.ts --no-plugin [...]
 *   ... --children  also record the server's child processes (pid, MB, command) at each step
 *   ... --work   each instance also runs one real task with OpenCode's own `build` agent (present with and without the
 *                plugin), so the same work is measured both ways; uses the free default model
 *
 * Isolated XDG sandbox, deleted at the end (also on failure).
 */
import { createOpencodeClient } from "@opencode-ai/sdk/v2"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSandbox, destroySandbox, prepareWorkdir, startServer, type Sandbox, type Server } from "../bench/sandbox"

const REPO = join(import.meta.dir, "../../..")
const FIXTURE = join(REPO, "script/fork/bench/fixtures/fix-integrity/paginate")
const SETTLE_MS = 4000
const TASK = "The tests in this repo fail; fix the code (not the tests). Run the tests before and after the fix."
const TASK_TIMEOUT_MS = 600_000

type Client = ReturnType<typeof createOpencodeClient>

/** Busy at least once, then idle for 3 polls in a row. */
async function runTask(client: Client): Promise<string> {
  const sessionID = ((await client.session.create({ title: "qa memory" })).data as { id: string }).id
  await client.session.promptAsync({ sessionID, agent: "build", parts: [{ type: "text", text: TASK }] })
  const deadline = Date.now() + TASK_TIMEOUT_MS
  let idle = 0
  while (idle < 3) {
    if (Date.now() > deadline) return "timeout"
    await Bun.sleep(2000)
    const statuses = ((await client.session.status({}).catch(() => ({ data: {} }))).data ?? {}) as Record<string, { type?: string }>
    idle = (statuses[sessionID]?.type ?? "idle") === "idle" ? idle + 1 : 0
  }
  return "done"
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

/** RSS of the server and every process it started (bun workers, LSP), in MB. */
function treeRssMb(pid: number): number {
  const out = Bun.spawnSync(["ps", "-o", "pid=,ppid=,rss=", "-e"]).stdout.toString()
  const rows = out.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number) as [number, number, number])
  const tree = new Set([pid])
  for (let changed = true; changed;) {
    changed = false
    for (const [child, parent] of rows) if (tree.has(parent) && !tree.has(child)) (tree.add(child), (changed = true))
  }
  return Math.round(rows.filter(([child]) => tree.has(child)).reduce((sum, [, , rss]) => sum + rss, 0) / 1024)
}

/** The server's descendants with their memory, for `--children` (which helpers each instance starts). */
function children(pid: number): Array<{ pid: number; mb: number; cmd: string }> {
  const out = Bun.spawnSync(["ps", "-o", "pid=,ppid=,rss=,args=", "-e"]).stdout.toString()
  const rows = out.trim().split("\n").map((line) => {
    const [child, parent, rss, ...cmd] = line.trim().split(/\s+/)
    return { pid: Number(child), ppid: Number(parent), mb: Math.round(Number(rss) / 1024), cmd: cmd.join(" ").slice(0, 140) }
  })
  const tree = new Set([pid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) if (tree.has(row.ppid) && !tree.has(row.pid)) (tree.add(row.pid), (changed = true))
  }
  return rows.filter((row) => row.pid !== pid && tree.has(row.pid)).map(({ pid: child, mb, cmd }) => ({ pid: child, mb, cmd }))
}

function serverRssMb(pid: number): number {
  const status = readFileSync(`/proc/${pid}/status`, "utf8")
  return Math.round(Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024)
}

function dropPlugin(sandbox: Sandbox): void {
  const path = join(sandbox.root, "config/opencode/opencode.json")
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
  delete config["plugin"]
  writeFileSync(path, JSON.stringify(config, null, 2))
}

async function main(): Promise<void> {
  const withPlugin = !process.argv.includes("--no-plugin")
  const work = process.argv.includes("--work")
  const plugin = option("plugin", join(REPO, "dist/index.js")) ?? ""
  const instances = Number(option("instances", "12"))
  const evidence = join(REPO, option("evidence", ".omo/evidence/incidents/server-memory") ?? "")
  mkdirSync(evidence, { recursive: true })
  const label = `${withPlugin ? "plugin" : "no-plugin"}${work ? "-work" : ""}`
  const report = join(evidence, `instances-${label}-${Date.now()}.jsonl`)

  const sandbox = createSandbox(join(tmpdir(), `omo-qa-mem-${process.pid}-${Date.now()}`), plugin)
  if (!withPlugin) dropPlugin(sandbox)
  let server: Server | undefined
  const stop = () => {
    server?.stop()
    destroySandbox(sandbox)
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stop(), process.exit(130)))
  try {
    server = await startServer(sandbox)
    const pid = server.pid
    if (pid === undefined) throw new Error("server pid unknown")
    const sample = (step: string, extra: Record<string, unknown> = {}) => {
      const row = { label, step, serverMb: serverRssMb(pid), treeMb: treeRssMb(pid), ...(process.argv.includes("--children") ? { children: children(pid) } : {}), ...extra }
      appendFileSync(report, `${JSON.stringify(row)}\n`)
      console.log(`${label.padEnd(9)} ${step.padEnd(14)} server ${String(row.serverMb).padStart(5)} MB  tree ${String(row.treeMb).padStart(5)} MB`)
      return row
    }
    await Bun.sleep(SETTLE_MS)
    sample("started")
    const dirs: string[] = []
    for (let index = 1; index <= instances; index++) {
      const dir = prepareWorkdir(sandbox, FIXTURE, `instance-${index}`)
      dirs.push(dir)
      const client = createOpencodeClient({ baseUrl: server.baseUrl, directory: dir })
      await client.session.list()
      const outcome = work ? await runTask(client) : undefined
      await Bun.sleep(SETTLE_MS)
      sample(`instance ${index}`, outcome ? { task: outcome } : {})
    }
    for (const dir of dirs) await createOpencodeClient({ baseUrl: server.baseUrl, directory: dir }).instance.dispose({ directory: dir })
    await Bun.sleep(SETTLE_MS * 3)
    sample("all disposed")
    console.log(`report: ${report}`)
  } finally {
    stop()
  }
}

await main()
