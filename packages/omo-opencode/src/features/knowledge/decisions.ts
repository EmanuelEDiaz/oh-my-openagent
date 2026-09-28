import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, isAbsolute, join, relative, resolve } from "node:path"

import { verifyCitation } from "./citations"
import type { CitationContext, EvidenceType, VerifiedCitation } from "./citations"
import { decisionDirectoryFor, decisionPaths, DECISIONS_DIR } from "./decision-files"
import { refreshPlanLinks } from "./plan-links"

export { DECISIONS_DIR } from "./decision-files"

export type Reversibility = "easy" | "costly" | "hard"

export type DecisionInput = {
  readonly title: string
  readonly context: string
  readonly options: readonly string[]
  readonly decision: string
  readonly reason: string
  readonly reversibility: Reversibility
  readonly evidence: readonly { readonly type: EvidenceType; readonly ref: string; readonly note?: string }[]
  readonly supersedes?: string
  readonly planPath?: string
  /** Optional grouping such as "cache" or "auth", used to filter views and searches. */
  readonly area?: string
}

export type DecisionOrigin = { readonly sessionId?: string; readonly messageId?: string; readonly agent?: string }

export type DecisionResult =
  | { readonly ok: true; readonly id: string; readonly path: string; readonly planPath?: string; readonly notes: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] }

export function slugify(title: string): string {
  return title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50).replace(/^-+|-+$/g, "") || "decision"
}

function quote(value: string): string {
  return JSON.stringify(value)
}

function nextId(projectDir: string, now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "")
  const taken = decisionPaths(projectDir)
    .map((path) => new RegExp(`^D-${day}-(\\d+)-`).exec(basename(path))?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  return `D-${day}-${Math.max(0, ...taken) + 1}`
}

export function findDecisionFile(projectDir: string, id: string): string | undefined {
  return decisionPaths(projectDir).find((path) => basename(path).startsWith(`${id}-`))
}

export function decisionStatus(projectDir: string, relativePath: string): string | undefined {
  try {
    return /^status:\s*(\S+)/m.exec(readFileSync(join(projectDir, relativePath), "utf-8"))?.[1]
  } catch {
    return undefined
  }
}

function resolvePlan(projectDir: string, planPath: string): string | string[] {
  const absolute = isAbsolute(planPath) ? planPath : resolve(projectDir, planPath)
  const inside = relative(projectDir, absolute)
  if (inside.startsWith("..") || isAbsolute(inside) || !inside.endsWith(".md")) return [`plan_path must be a .md file inside the project: ${planPath}`]
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return [`plan_path does not exist: ${planPath}`]
  return absolute
}

/** Evidence citing the plan's own "## Decisions log" section justifies the decision with itself. */
function circularEvidence(projectDir: string, planFile: string, evidence: readonly VerifiedCitation[]): string[] {
  const planPath = relative(projectDir, planFile)
  const lines = readFileSync(planFile, "utf-8").split("\n")
  const start = lines.findIndex((line) => /^##\s+Decisions log\s*$/i.test(line))
  if (start === -1) return []
  const next = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
  const end = next === -1 ? lines.length : next
  return evidence
    .filter((item) => item.citation.type === "file" && item.citation.path === planPath)
    .filter((item) => {
      if (item.citation.type !== "file") return false
      const from = item.citation.startLine ?? 1
      const to = item.citation.endLine ?? lines.length
      return from <= end && to >= start + 1
    })
    .map((item) => `evidence file "${item.ref}": circular — it cites the Decisions log this decision is linked into; cite the code, test, commit, chat or source that justifies it`)
}

function sessionPointer(origin: DecisionOrigin): string | undefined {
  if (!origin.sessionId) return undefined
  return origin.messageId ? `${origin.sessionId} → ${origin.messageId}` : origin.sessionId
}

function renderRecord(id: string, date: string, input: DecisionInput, evidence: readonly (VerifiedCitation & { note?: string })[], origin: DecisionOrigin, planPath?: string): string {
  const pointer = sessionPointer(origin)
  const frontmatter = [
    "---",
    `id: ${id}`,
    `title: ${quote(input.title)}`,
    "status: active",
    `date: ${date}`,
    `reversibility: ${input.reversibility}`,
    ...(input.area ? [`area: ${quote(input.area)}`] : []),
    ...(input.supersedes ? [`supersedes: ${input.supersedes}`] : []),
    ...(origin.agent ? [`agent: ${quote(origin.agent)}`] : []),
    ...(origin.sessionId ? [`session: ${[origin.sessionId, origin.messageId].filter(Boolean).join("/")}`] : []),
    ...(planPath ? ["plans:", `  - ${quote(planPath)}`] : []),
    "evidence:",
    ...evidence.flatMap((item) => [
      `  - type: ${item.citation.type}`,
      `    ref: ${quote(item.ref)}`,
      ...(item.fingerprint ? [`    fingerprint: ${item.fingerprint}`] : []),
      ...(item.note ? [`    note: ${quote(item.note)}`] : []),
    ]),
    "---",
  ]
  const body = [
    `# ${id}: ${input.title}`,
    "",
    `- **Context:** ${input.context}`,
    "- **Options considered:**",
    ...input.options.map((option) => `  - ${option}`),
    `- **Decision:** ${input.decision}`,
    `- **Reason:** ${input.reason}`,
    `- **Reversibility:** ${input.reversibility}`,
    "- **Evidence:**",
    ...evidence.map((item) => `  - \`${item.ref}\`${item.note ? ` — ${item.note}` : ""}`),
    ...(pointer ? [`- **Evidence session:** \`${pointer}\``] : []),
    ...(input.supersedes ? [`- **Supersedes:** ${input.supersedes}`] : []),
  ]
  return `${frontmatter.join("\n")}\n${body.join("\n")}\n`
}

function markSuperseded(projectDir: string, oldPath: string, newId: string): void {
  const absolute = join(projectDir, oldPath)
  const content = readFileSync(absolute, "utf-8")
  writeFileSync(absolute, content.replace(/^status:\s*\S+$/m, `status: superseded\nsuperseded_by: ${newId}`))
}

/**
 * Records a decision in docs/decisions/ (versioned with the project) and, when a plan is given, in the
 * plan's Decisions log. Every evidence item must verify (existing file lines, commit, chat message or
 * a well-formed URL); otherwise nothing is written and the problems are returned.
 */
export function recordDecision(input: DecisionInput, origin: DecisionOrigin, context: CitationContext, now: Date = new Date()): DecisionResult {
  const problems: string[] = []
  if (input.title.trim().length === 0) problems.push("title is required")
  if (input.options.length === 0) problems.push("list at least one option considered")
  if (input.evidence.length === 0) problems.push("at least one evidence item is required (file:line, commit, url or ses_…/msg_…/prt_…)")

  const verified: (VerifiedCitation & { note?: string })[] = []
  for (const item of input.evidence) {
    const result = verifyCitation(item.type, item.ref, context)
    if (result.ok) verified.push({ ...result, ...(item.note ? { note: item.note } : {}) })
    else problems.push(`evidence ${item.type} "${result.ref}": ${result.reason}`)
  }

  const plan = input.planPath ? resolvePlan(context.projectDir, input.planPath) : undefined
  if (typeof plan === "string") problems.push(...circularEvidence(context.projectDir, plan, verified))

  const oldPath = input.supersedes ? findDecisionFile(context.projectDir, input.supersedes) : undefined
  if (input.supersedes && !oldPath) problems.push(`supersedes ${input.supersedes}: no such decision in ${DECISIONS_DIR}`)
  if (Array.isArray(plan)) problems.push(...plan)
  if (problems.length > 0) return { ok: false, problems }

  const id = nextId(context.projectDir, now)
  const directory = decisionDirectoryFor(context.projectDir, now.toISOString().slice(0, 4))
  const path = join(directory, `${id}-${slugify(input.title)}.md`)
  const planPath = typeof plan === "string" ? relative(context.projectDir, plan) : undefined
  mkdirSync(join(context.projectDir, directory), { recursive: true })
  writeFileSync(join(context.projectDir, path), renderRecord(id, now.toISOString().slice(0, 10), input, verified, origin, planPath))
  if (oldPath) markSuperseded(context.projectDir, oldPath, id)
  refreshPlanLinks(context.projectDir)

  const notes: string[] = []
  if (input.reversibility === "hard") notes.push("Reversibility is hard: this is an ADR candidate (promote it to docs/adr/ when the task closes).")
  if (oldPath) notes.push(`${input.supersedes} is now marked superseded by ${id}.`)
  if (!origin.sessionId) notes.push("No session pointer was available for this decision.")
  return { ok: true, id, path, ...(planPath ? { planPath } : {}), notes }
}
