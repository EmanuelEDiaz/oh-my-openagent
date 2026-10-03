/**
 * Lossless resume (fork roadmap 0.8c). When work stops (retry budget spent, SIGTERM, memory pressure, the user's stop),
 * a resume card is written to `.omo/runs/<id>/` and the uncommitted work is captured in `refs/omo/wip/<id>`: a commit
 * object built from a temporary index, so the user's index, files, branch and history are never touched.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { writeFileAtomically } from "../../shared/write-file-atomically"

export type ResumeItem = { readonly locator: string; readonly text: string }

export type WipCapture = {
  readonly ref: string
  readonly commit: string
  /** HEAD when the work was captured. */
  readonly base: string
  readonly diffStat: string
}

export type ResumeCard = {
  readonly id: string
  readonly createdAt: string
  /** Why the work stopped, in one line. */
  readonly reason: string
  readonly sessionID: string
  readonly agent?: string
  readonly model?: string
  /** The user's requests, verbatim. */
  readonly requests: readonly ResumeItem[]
  readonly plan?: { readonly path: string; readonly progress: string; readonly currentTask?: string }
  readonly decisions: readonly { readonly id: string; readonly title: string }[]
  readonly filesChanged: readonly string[]
  readonly errors: readonly ResumeItem[]
  /** What was tried and failed, so a resumed agent does not repeat it. */
  readonly attempts: readonly { readonly model?: string; readonly outcome: string }[]
  readonly wip?: WipCapture
  readonly nextAction: string
  /** Set when a session picked the work up again; resumed cards are kept as history but not listed as paused. */
  readonly resumedAt?: string
}

const RUNS_DIR = [".omo", "runs"]
// Identity for the hidden WIP object only; it never enters a branch or the user's history.
const WIP_IDENTITY = { GIT_AUTHOR_NAME: "omo-wip", GIT_AUTHOR_EMAIL: "omo-wip@localhost", GIT_COMMITTER_NAME: "omo-wip", GIT_COMMITTER_EMAIL: "omo-wip@localhost" }

function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): { ok: boolean; out: string } {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  return { ok: run.exitCode === 0, out: run.stdout.toString().trim() }
}

function runsDir(projectDir: string): string {
  return join(projectDir, ...RUNS_DIR)
}

export function captureWip(projectDir: string, id: string): WipCapture | undefined {
  if (!git(projectDir, ["rev-parse", "--is-inside-work-tree"]).ok) return undefined
  const base = git(projectDir, ["rev-parse", "HEAD"])
  if (!base.ok) return undefined
  const index = join(tmpdir(), `omo-wip-index-${process.pid}-${Date.now()}`)
  try {
    const env = { GIT_INDEX_FILE: index, ...WIP_IDENTITY }
    if (!git(projectDir, ["read-tree", "HEAD"], env).ok) return undefined
    if (!git(projectDir, ["add", "-A"], env).ok) return undefined
    const tree = git(projectDir, ["write-tree"], env)
    if (!tree.ok) return undefined
    const commit = git(projectDir, ["commit-tree", tree.out, "-p", base.out, "-m", `omo wip ${id}`], env)
    if (!commit.ok) return undefined
    const ref = `refs/omo/wip/${id}`
    if (!git(projectDir, ["update-ref", ref, commit.out]).ok) return undefined
    const diffStat = git(projectDir, ["diff", "--stat", base.out, commit.out]).out
    return { ref, commit: commit.out, base: base.out, diffStat }
  } finally {
    rmSync(index, { force: true })
  }
}

/** Whether the working tree still holds exactly the saved work, and how to get it back if not. */
export function restoreCheck(projectDir: string, wip: WipCapture): { matches: boolean; howToRestore: string } {
  const now = captureWip(projectDir, `check-${Date.now()}`)
  const matches = now !== undefined && git(projectDir, ["rev-parse", `${now.commit}^{tree}`]).out === git(projectDir, ["rev-parse", `${wip.commit}^{tree}`]).out
  if (now) git(projectDir, ["update-ref", "-d", now.ref])
  return {
    matches,
    howToRestore: `git diff ${wip.base} ${wip.ref} | git apply   # or inspect with: git show --stat ${wip.ref}`,
  }
}

export function renderResumeMarkdown(card: ResumeCard): string {
  const list = (items: readonly string[]) => (items.length === 0 ? "- (none)" : items.map((item) => `- ${item}`).join("\n"))
  return [
    `# Resume ${card.id}`,
    "",
    `Stopped: ${card.createdAt} — ${card.reason}`,
    `Session: ${card.sessionID}${card.agent ? ` · agent ${card.agent}` : ""}${card.model ? ` · model ${card.model}` : ""}`,
    "",
    "## The user's requests (verbatim)",
    list(card.requests.map((request) => `${request.text} (${request.locator})`)),
    "",
    "## Plan",
    card.plan ? `- ${card.plan.path} · ${card.plan.progress}${card.plan.currentTask ? ` · current: ${card.plan.currentTask}` : ""}` : "- (no plan)",
    "",
    "## Decisions",
    list(card.decisions.map((decision) => `${decision.id}: ${decision.title}`)),
    "",
    "## Work in progress",
    card.wip ? `Saved in \`${card.wip.ref}\` (base ${card.wip.base.slice(0, 12)}):\n\n\`\`\`\n${card.wip.diffStat || "(no changes)"}\n\`\`\`` : "Not captured (not a git repository).",
    `Files changed in the session: ${card.filesChanged.join(", ") || "(none)"}`,
    "",
    "## Last errors",
    list(card.errors.map((error) => `${error.text} (${error.locator})`)),
    "",
    "## Do not repeat",
    list(card.attempts.map((attempt) => `${attempt.outcome}${attempt.model ? ` with ${attempt.model}` : ""}`)),
    "",
    "## Next action",
    card.nextAction,
    "",
  ].join("\n")
}

export function saveResume(projectDir: string, card: ResumeCard): string {
  const dir = join(runsDir(projectDir), card.id)
  mkdirSync(dir, { recursive: true })
  const gitignore = join(runsDir(projectDir), ".gitignore")
  if (!existsSync(gitignore)) writeFileSync(gitignore, "*\n")
  writeFileAtomically(join(dir, "resume.json"), `${JSON.stringify(card, null, 2)}\n`)
  writeFileAtomically(join(dir, "RESUME.md"), renderResumeMarkdown(card))
  return dir
}

export function loadResume(projectDir: string, id: string): ResumeCard | undefined {
  const file = join(runsDir(projectDir), id, "resume.json")
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ResumeCard
  } catch {
    return undefined
  }
}

/** Paused runs, newest first. */
export function listPaused(projectDir: string): ResumeCard[] {
  const dir = runsDir(projectDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadResume(projectDir, entry.name))
    .filter((card): card is ResumeCard => card !== undefined && card.resumedAt === undefined)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** The run finished: drop its card and its WIP ref. */
export function deleteResume(projectDir: string, id: string): void {
  const card = loadResume(projectDir, id)
  if (card?.wip) git(projectDir, ["update-ref", "-d", card.wip.ref])
  rmSync(join(runsDir(projectDir), id), { recursive: true, force: true })
}
