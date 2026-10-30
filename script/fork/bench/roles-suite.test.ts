import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSandbox, destroySandbox, prepareWorkdir } from "./sandbox"
import { ROLE_TASKS } from "./tasks/roles"
import type { GradeContext, Transcript } from "./types"

const root = join(mkdtempSync(join(tmpdir(), "bench-roles-")), "sb")
const sandbox = createSandbox(root, join(import.meta.dir, "sandbox.ts"))
afterAll(() => destroySandbox(sandbox))

function transcript(answer: string): Transcript {
  return { agent: "Prometheus - Plan Builder", model: "x/y", answer, tools: [], tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0, turns: 1, durationMs: 1, delegatedAgents: [] }
}

async function failing(workdir: string, answer: string): Promise<string[]> {
  const context: GradeContext = { transcript: transcript(answer), workdir }
  const grades = await Promise.all(ROLE_TASKS[0]!.expect.map((grader) => grader.grade(context)))
  return grades.filter((grade) => !grade.pass).map((grade) => grade.name)
}

describe("roles suite (fork 0.22)", () => {
  test("#given an untouched repo, a plan in .omo and a switch recommendation #then every grader passes", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "untouched")
    Bun.spawnSync(["mkdir", "-p", join(workdir, ".omo/plans")])
    writeFileSync(join(workdir, ".omo/plans/slugify.md"), "# plan\n")
    expect(await failing(workdir, "Esto es implementación: cambia a Atlas (Tab) para ejecutarlo; aquí tienes el plan.")).toEqual([])
  })

  test("#given the agent edited code and committed #then the code and commit graders fail", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "edited")
    writeFileSync(join(workdir, "src/text.ts"), "export const slugify = (s: string) => s\n")
    Bun.spawnSync(["git", "-c", "user.name=a", "-c", "user.email=a@x.invalid", "commit", "-qam", "slug"], { cwd: workdir })
    writeFileSync(join(workdir, "CHANGELOG.md"), "v1.0\n")
    expect(await failing(workdir, "Hecho.")).toEqual(["outcome:codeUntouched", "outcome:noNewCommit", expect.stringMatching(/^answerMatches:/)])
  })

  test("#given every case #then Prometheus is the agent and the extreme case is held out", () => {
    expect(ROLE_TASKS.map((task) => [task.id, task.agent, task.split])).toEqual([
      ["roles/hard-prometheus-implement", "Prometheus - Plan Builder", "dev"],
      ["roles/simple-prometheus-commit", "Prometheus - Plan Builder", "dev"],
      ["roles/extreme-prometheus-fix-now", "Prometheus - Plan Builder", "holdout"],
    ])
  })
})
