#!/usr/bin/env bun
/**
 * Re-scores saved bench results with the current graders, without calling any model again:
 *
 *   bun script/fork/bench/regrade.ts .omo/evals/<file>.jsonl [--label <label>] [--k 3]
 *
 * Each run gets a fresh copy of its fixture, and the absolute paths the agent cited are mapped onto it. Outcome
 * graders keep their recorded result, because the final state of the repo is gone. Valid for read-only tasks; for
 * tasks that change files only the non-outcome graders are re-checked.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { defaultFixtureCache, resolveFixture } from "./fixtures"
import { gradersFor } from "./graders"
import { renderReport } from "./report"
import { summarize } from "./score"
import { EXPLORE_TASKS } from "./tasks/explore"
import { FIX_INTEGRITY_TASKS } from "./tasks/fix-integrity"
import { LOOP_TASKS } from "./tasks/loops"
import { LIBRARIAN_WEB_TASKS, WEB_RESEARCHER_TASKS } from "./tasks/web-research"
import type { RunResult, Task } from "./types"

const REPO = join(import.meta.dir, "../../..")
const TASKS: readonly Task[] = [...EXPLORE_TASKS, ...WEB_RESEARCHER_TASKS, ...LIBRARIAN_WEB_TASKS, ...FIX_INTEGRITY_TASKS, ...LOOP_TASKS]

export async function regradeResult(result: RunResult, task: Task, fixtureDir: string): Promise<RunResult> {
  if (result.failure === "infra" || result.transcript === undefined) return result
  const workdir = mkdtempSync(join(tmpdir(), "bench-regrade-"))
  try {
    cpSync(fixtureDir, workdir, { recursive: true })
    const answer = result.workdir ? result.transcript.answer.replaceAll(result.workdir, workdir) : result.transcript.answer
    const transcript = { ...result.transcript, answer }
    const recorded = new Map(result.grades.map((grade) => [grade.name, grade]))
    const grades = await Promise.all(gradersFor(task).map((grader) =>
      grader.name.startsWith("outcome") && recorded.has(grader.name) ? recorded.get(grader.name)! : grader.grade({ transcript, workdir })))
    const pass = transcript.error === undefined && grades.every((grade) => grade.pass)
    const { failure: _previous, ...rest } = result
    return { ...rest, pass, ...(pass ? {} : { failure: "task" as const }), grades }
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file || !existsSync(file)) throw new Error("usage: regrade.ts <results.jsonl> [--label <label>] [--k 3]")
  const option = (name: string) => {
    const index = process.argv.indexOf(`--${name}`)
    return index === -1 ? undefined : process.argv[index + 1]
  }
  const results = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line) as RunResult)
  const regraded: RunResult[] = []
  for (const result of results) {
    const task = TASKS.find((candidate) => candidate.id === result.taskId)
    if (!task) throw new Error(`unknown task ${result.taskId}`)
    regraded.push(await regradeResult(result, task, await resolveFixture(task.fixture, defaultFixtureCache())))
  }
  const out = file.replace(/\.jsonl$/, ".regraded.jsonl")
  writeFileSync(out, `${regraded.map((result) => JSON.stringify(result)).join("\n")}\n`)
  const summary = summarize(regraded, Number(option("k") ?? "3"))
  console.log(JSON.stringify({ ...summary, tasks: summary.tasks.map((task) => `${task.taskId} ${task.passed}/${task.scored}`) }, null, 2))
  console.log(`regraded results: ${out}`)
  const label = option("label")
  if (label) {
    const agent = results[0]?.taskId.split("/")[0] ?? "agent"
    const reportFile = join(REPO, "docs/fork/evals", `${agent}.md`)
    const previous = existsSync(reportFile) ? readFileSync(reportFile, "utf8") : undefined
    writeFileSync(reportFile, renderReport(previous, summary, { agent, date: new Date().toISOString().slice(0, 10), label, split: "dev" }))
    console.log(`report: ${reportFile}`)
  }
}

if (import.meta.main) await main()
