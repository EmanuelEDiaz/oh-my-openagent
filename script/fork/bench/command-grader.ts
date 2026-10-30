/**
 * Graders for real projects (docs/fork/plans/real-project-bench.md): any build or test command run in the agent's
 * workdir, and how many of the arbiter's confirmed defects an audit report names.
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { Grader, GradeResult } from "./types"

export type CommandGraderOptions = {
  readonly name: string
  readonly command: readonly string[]
  /** Relative to the workdir. */
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

const OUTPUT_TAIL_LINES = 12

/** Passes when the command exits 0. Runs synchronously, so heavy commands (mvn, next build) never overlap. */
export function commandGrader(options: CommandGraderOptions): Grader {
  return {
    name: options.name,
    grade: ({ workdir }): GradeResult => {
      const run = Bun.spawnSync([...options.command], {
        cwd: join(workdir, options.cwd ?? "."),
        env: { ...process.env, ...options.env },
        stdout: "pipe",
        stderr: "pipe",
        timeout: options.timeoutMs,
      })
      if (run.exitCode === 0) return { name: options.name, pass: true }
      const tail = `${run.stdout.toString()}${run.stderr.toString()}`.trim().split("\n").slice(-OUTPUT_TAIL_LINES).join("\n")
      const reason = run.exitCode === null ? `timed out after ${options.timeoutMs} ms` : `exit ${run.exitCode}`
      return { name: options.name, pass: false, detail: `${reason}\n${tail}` }
    },
  }
}

export type ReferenceDefect = { readonly id: string; readonly patterns: readonly RegExp[] }

/**
 * Recall of an audit: the share of reference defects (confirmed by the arbiter) that the agent's report names. False
 * positives are judged by the arbiter, not here.
 */
export function defectRecall(options: { readonly report: string; readonly defects: readonly ReferenceDefect[]; readonly minRecall: number }): Grader {
  const name = "outcome:defectRecall"
  return {
    name,
    grade: ({ workdir }): GradeResult => {
      const path = join(workdir, options.report)
      if (!existsSync(path)) return { name, pass: false, detail: `report ${options.report} not found` }
      const text = readFileSync(path, "utf8")
      const missed = options.defects.filter((defect) => !defect.patterns.some((pattern) => pattern.test(text))).map((defect) => defect.id)
      const found = options.defects.length - missed.length
      const recall = options.defects.length === 0 ? 1 : found / options.defects.length
      const detail = `found ${found}/${options.defects.length}${missed.length > 0 ? `; missed: ${missed.join(", ")}` : ""}`
      return { name, pass: recall >= options.minRecall, detail }
    },
  }
}
