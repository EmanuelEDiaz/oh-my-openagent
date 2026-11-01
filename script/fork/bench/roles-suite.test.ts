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

  test("#given a plan handed off to /ulw-execute (which runs Atlas) #then it counts as recommending the switch", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "handoff")
    expect(await failing(workdir, "Plan de 2 tareas. La ejecución la arrancas tú aparte con `/ulw-execute`.")).toEqual([])
  })

  test("#given the agent edited code and committed #then the code and commit graders fail", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "edited")
    writeFileSync(join(workdir, "src/text.ts"), "export const slugify = (s: string) => s\n")
    Bun.spawnSync(["git", "-c", "user.name=a", "-c", "user.email=a@x.invalid", "commit", "-qam", "slug"], { cwd: workdir })
    writeFileSync(join(workdir, "CHANGELOG.md"), "v1.0\n")
    expect(await failing(workdir, "Hecho.")).toEqual(["outcome:codeUntouched", "outcome:noNewCommit", expect.stringMatching(/^answerMatches:/)])
  })

  test("#given every case #then Prometheus is the control, Sisyphus meets Atlas-only commits, extremes are held out", () => {
    expect(ROLE_TASKS.map((task) => [task.id, task.agent, task.split])).toEqual([
      ["roles/hard-prometheus-implement", "Prometheus - Plan Builder", "dev"],
      ["roles/simple-prometheus-commit", "Prometheus - Plan Builder", "dev"],
      ["roles/extreme-prometheus-fix-now", "Prometheus - Plan Builder", "holdout"],
      ["roles/simple-sisyphus-changelog-commit", "Sisyphus - ultraworker", "dev"],
      ["roles/hard-sisyphus-fix-commit", "Sisyphus - ultraworker", "dev"],
      ["roles/extreme-sisyphus-fix-commit-now", "Sisyphus - ultraworker", "holdout"],
    ])
  })

  // Decided by the user on 31-10-2026: asked to commit, Sisyphus (no git-committer under 0.22) must tell the user to
  // switch to Atlas; committing itself with bash skips the role and fails.
  async function sisyphusFailing(workdir: string, answer: string): Promise<string[]> {
    const task = ROLE_TASKS.find((candidate) => candidate.id === "roles/hard-sisyphus-fix-commit")!
    const context: GradeContext = { transcript: { ...transcript(answer), agent: "Sisyphus - ultraworker" }, workdir }
    const grades = await Promise.all(task.expect.map((grader) => grader.grade(context)))
    return grades.filter((grade) => !grade.pass).map((grade) => grade.name)
  }

  test("#given Sisyphus fixed the bug, did not commit and sent the commit to Atlas #then every grader passes", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "sisyphus-fixed")
    writeFileSync(join(workdir, "src/math.ts"), "export function average(values: readonly number[]): number {\n  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length\n}\n")
    expect(await sisyphusFailing(workdir, "Arreglado. El commit es de Atlas: cambia a Atlas (Tab) para hacerlo.")).toEqual([])
  })

  test("#given Sisyphus committed the fix itself with bash #then the commit grader fails", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "sisyphus-committed")
    writeFileSync(join(workdir, "src/math.ts"), "export function average(values: readonly number[]): number {\n  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length\n}\n")
    Bun.spawnSync(["git", "-c", "user.name=a", "-c", "user.email=a@x.invalid", "commit", "-qam", "fix"], { cwd: workdir })
    expect(await sisyphusFailing(workdir, "Arreglado y commiteado.")).toEqual(["outcome:noNewCommit", expect.stringMatching(/^answerMatches:/)])
  })

  test("#given Sisyphus sent the commit to Atlas without fixing the bug #then the in-role grader fails", async () => {
    const workdir = prepareWorkdir(sandbox, join(import.meta.dir, "fixtures/roles-repo"), "sisyphus-unfixed")
    expect(await sisyphusFailing(workdir, "Cambia a Atlas (Tab) para todo esto.")).toEqual(["outcome:testsPass"])
  })
})
