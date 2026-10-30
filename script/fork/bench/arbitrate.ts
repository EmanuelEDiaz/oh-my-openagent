#!/usr/bin/env bun
/**
 * Records the arbiter's verdict on a real-project run (docs/fork/plans/real-project-bench.md):
 *
 *   bun script/fork/bench/arbitrate.ts <raw.jsonl> <task id> <repeat, 1-based> pass|fail "<reason>"
 *   bun script/fork/bench/arbitrate.ts <raw.jsonl>        # lists each run with its automatic and arbiter verdicts
 */
import { readFileSync } from "node:fs"

import { recordVerdict } from "./arbiter"
import type { RunResult } from "./types"

const [file, taskId, repeat, verdict, reason] = process.argv.slice(2)
if (file === undefined) throw new Error("usage: arbitrate.ts <raw.jsonl> [<task id> <repeat> pass|fail <reason>]")
if (taskId !== undefined) {
  if (verdict !== "pass" && verdict !== "fail") throw new Error("the verdict must be pass or fail")
  if (!reason) throw new Error("a verdict needs its reason")
  recordVerdict(file, taskId, Number(repeat) - 1, verdict, reason)
}
for (const run of readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RunResult)) {
  const automatic = run.pass === undefined ? "infra" : run.pass ? "pass" : "fail"
  console.log(`${run.taskId} #${run.repeat + 1}: automatic ${automatic}; arbiter ${run.arbiter ? `${run.arbiter.verdict} (${run.arbiter.reason})` : "pending"}`)
}
