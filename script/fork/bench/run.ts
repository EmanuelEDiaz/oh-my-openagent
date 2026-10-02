#!/usr/bin/env bun
/**
 * Agent test bench (fork roadmap 3.0, docs/fork/plans/test-bench.md).
 *
 *   bun script/fork/bench/run.ts --agent explore [--split dev|holdout|all] [--repeat 3] [--label baseline]
 *                                [--task <id>] [--smoke] [--offline] [--allow-stale]
 *
 * Builds nothing: run the plugin build first (the bench refuses a dist/ older than the sources). Uses the models the
 * user picked with /omo-models; each result records the model each agent really used. Sandbox and its copy of
 * auth.json are deleted at the end, also on failure or Ctrl-C.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveFixture } from "./fixtures"
import { renderReport } from "./report"
import { pendingRuns } from "./resume"
import { runTask } from "./runner"
import { createSandbox, destroySandbox, isHealthy, saveServerLogs, startServer, warmUp, type Sandbox, type Server } from "./sandbox"
import { isConfigError, summarize } from "./score"
import { EXPLORE_TASKS } from "./tasks/explore"
import type { RunResult, Task } from "./types"

const REPO = join(import.meta.dir, "../../..")
const SUITES: Record<string, readonly Task[]> = { explore: EXPLORE_TASKS }
const INFRA_RETRIES = 2
const FIXTURE_CACHE = join(REPO, ".omo/bench-cache")

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function newestSourceMtime(): number {
  let newest = 0
  for (const file of new Bun.Glob("packages/*/src/**/*.ts").scanSync({ cwd: REPO })) {
    if (file.endsWith(".test.ts")) continue
    newest = Math.max(newest, statSync(join(REPO, file)).mtimeMs)
  }
  return newest
}

async function fetchStatus(url: string): Promise<number> {
  const request = (method: string) => fetch(url, { method, redirect: "follow", signal: AbortSignal.timeout(10_000) }).then((response) => response.status)
  const status = await request("HEAD")
  return status === 405 || status === 403 ? request("GET") : status
}

async function main(): Promise<void> {
  const agent = option("agent")
  const suite = agent === undefined ? undefined : SUITES[agent]
  if (!agent || !suite) throw new Error(`--agent must be one of: ${Object.keys(SUITES).join(", ")}`)
  const smoke = flag("smoke")
  const split = option("split", "dev") ?? "dev"
  const repeats = smoke ? 1 : Number(option("repeat", "3"))
  const k = Number(option("k", "3"))
  const label = option("label", smoke ? "smoke" : "run") ?? "run"
  const only = option("task")
  const plugin = option("plugin", join(REPO, "dist/index.js")) ?? ""

  let tasks = suite.filter((task) => split === "all" || task.split === split)
  if (only) tasks = tasks.filter((task) => task.id === only || task.id.endsWith(`/${only}`))
  if (smoke) tasks = tasks.slice(0, 1)
  if (tasks.length === 0) throw new Error("no task matches the filters")

  if (!existsSync(plugin)) throw new Error(`plugin entry ${plugin} not found; build the plugin first`)
  if (!flag("allow-stale") && statSync(plugin).mtimeMs < newestSourceMtime()) {
    throw new Error(`${plugin} is older than the sources: rebuild the plugin first (or pass --allow-stale)`)
  }

  const date = new Date().toISOString().slice(0, 10)
  const evalsDir = join(REPO, ".omo/evals")
  mkdirSync(evalsDir, { recursive: true })
  // --resume <file>: continue a broken run into the same file, skipping what it already scored.
  const resumeFile = option("resume")
  if (resumeFile !== undefined && !existsSync(resumeFile)) throw new Error(`--resume file ${resumeFile} not found`)
  const rawFile = resumeFile ?? join(evalsDir, `${date}-${agent}-${label.replaceAll(/\W+/g, "-")}-${Date.now()}.jsonl`)
  const previousResults: RunResult[] = resumeFile === undefined
    ? []
    : readFileSync(resumeFile, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunResult)

  let sandbox: Sandbox | undefined
  let server: Server | undefined
  const cleanup = () => {
    server?.stop()
    if (sandbox) {
      saveServerLogs(sandbox, rawFile.replace(/\.jsonl$/, "-logs"))
      destroySandbox(sandbox)
    }
    server = undefined
    sandbox = undefined
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      cleanup()
      process.exit(130)
    })
  }

  const results: RunResult[] = [...previousResults]
  const pending = pendingRuns(previousResults, tasks.map((task) => task.id), repeats, INFRA_RETRIES)
  if (resumeFile !== undefined) console.log(`resuming ${resumeFile}: ${previousResults.length} saved result(s), ${pending.length} run(s) to go`)
  try {
    sandbox = createSandbox(join(tmpdir(), `omo-bench-${process.pid}-${Date.now()}`), plugin)
    console.log(`sandbox ${sandbox.root}; starting OpenCode (the first start can take minutes)…`)
    const start = async (box: Sandbox): Promise<Server> => {
      const started = await startServer(box)
      if (!(await warmUp(box, started))) console.log("warning: the plugin's provider cache did not appear; tasks run as a first install")
      return started
    }
    server = await start(sandbox)
    for (const { taskId, repeat, nextAttempt } of pending) {
      const task = tasks.find((candidate) => candidate.id === taskId)!
      {
        for (let attempt = nextAttempt; attempt <= INFRA_RETRIES; attempt++) {
          // A stalled model can leave the server unresponsive: restart it rather than failing every later task.
          if (!(await isHealthy(server))) {
            console.log("warning: server unresponsive; restarting it")
            server.stop()
            server = await start(sandbox)
          }
          const result = await runTask(task, {
            baseUrl: server.baseUrl,
            sandbox,
            fixtureDir: await resolveFixture(task.fixture, FIXTURE_CACHE),
            repeat,
            attempt,
            ...(flag("offline") ? {} : { fetchStatus }),
          })
          results.push(result)
          appendFileSync(rawFile, `${JSON.stringify(result)}\n`)
          const verdict = result.pass === undefined ? `INFRA (${result.error?.slice(0, 120)})` : result.pass ? "PASS" : `FAIL ${result.grades.filter((grade) => !grade.pass).map((grade) => grade.name).join(", ") || result.error}`
          console.log(`${task.id} #${repeat + 1}${attempt > 0 ? ` retry ${attempt}` : ""}: ${verdict}`)
          if (result.error !== undefined && isConfigError(result.error)) {
            throw new Error(`configuration problem, not the agent's: ${result.error}\nFix the models with /omo-models and run again.`)
          }
          if (result.failure !== "infra") break
        }
      }
    }
  } finally {
    cleanup()
  }

  const summary = summarize(results, k)
  console.log(JSON.stringify({ ...summary, tasks: undefined }, null, 2))
  console.log(`raw results: ${rawFile}`)
  if (!smoke) {
    const reportFile = join(REPO, "docs/fork/evals", `${agent}.md`)
    mkdirSync(join(REPO, "docs/fork/evals"), { recursive: true })
    const previous = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : undefined
    writeFileSync(reportFile, renderReport(previous, summary, { agent, date, label, split }))
    console.log(`report: ${reportFile}`)
  }
}

await main()
