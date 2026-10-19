#!/usr/bin/env bun
/**
 * How much memory each OpenCode instance costs, with and without the plugin (finding of 19-10-2026: the bench server
 * reached 1.6 GB after 19 task folders, one OpenCode instance each, never disposed). No model is called: an instance
 * starts when a request names a new directory, and that alone loads the plugin.
 *
 *   bun script/fork/qa/instance-memory.ts --plugin dist-x/index.js [--instances 12] [--evidence .omo/evidence/x]
 *   bun script/fork/qa/instance-memory.ts --no-plugin [...]
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
  const plugin = option("plugin", join(REPO, "dist/index.js")) ?? ""
  const instances = Number(option("instances", "12"))
  const evidence = join(REPO, option("evidence", ".omo/evidence/incidents/server-memory") ?? "")
  mkdirSync(evidence, { recursive: true })
  const label = withPlugin ? "plugin" : "no-plugin"
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
      const row = { label, step, serverMb: serverRssMb(pid), treeMb: treeRssMb(pid), ...extra }
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
      await createOpencodeClient({ baseUrl: server.baseUrl, directory: dir }).session.list()
      await Bun.sleep(SETTLE_MS)
      sample(`instance ${index}`)
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
