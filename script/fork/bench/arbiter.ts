/**
 * The arbiter's half of a real-project run (docs/fork/plans/real-project-bench.md): what the agent did is kept before
 * the workdir is deleted, and a reviewer later records a verdict next to the automatic grades.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { RunResult, Transcript } from "./types"

/** Saves the agent's whole change (against the fixture commit), its final answer and its tool calls. */
export function saveArbiterPackage(outDir: string, name: string, workdir: string, transcript: Transcript): string {
  const dir = join(outDir, name)
  mkdirSync(dir, { recursive: true })
  const git = (...args: string[]) => Bun.spawnSync(["git", ...args], { cwd: workdir, stdout: "pipe", stderr: "pipe" })
  // Untracked files count: new tests are often the most important part of the change.
  git("add", "-A", "--", ".", ":(exclude)node_modules", ":(exclude)**/node_modules", ":(exclude).omo")
  writeFileSync(join(dir, "diff.patch"), git("diff", "--cached", "HEAD").stdout.toString())
  writeFileSync(join(dir, "answer.md"), transcript.answer)
  writeFileSync(join(dir, "tools.jsonl"), transcript.tools.map((tool) => JSON.stringify({ tool: tool.tool, status: tool.status, input: tool.input })).join("\n"))
  return dir
}

/** Writes the reviewer's verdict onto the matching run of a raw results file. */
export function recordVerdict(file: string, taskId: string, repeat: number, verdict: "pass" | "fail", reason: string): void {
  const runs = readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunResult)
  // Retries of one repeat share it; the verdict belongs to the last attempt, the one that was scored.
  const index = runs.findLastIndex((run) => run.taskId === taskId && run.repeat === repeat)
  if (index === -1) throw new Error(`no run of ${taskId} #${repeat + 1} in ${file}`)
  runs[index] = { ...runs[index]!, arbiter: { verdict, reason, at: new Date().toISOString() } }
  writeFileSync(file, `${runs.map((run) => JSON.stringify(run)).join("\n")}\n`)
}
