import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"

import { verifyCitation } from "./citations"
import type { CitationContext, EvidenceType, VerifiedCitation } from "./citations"

export const DECISIONS_DIR = "docs/decisions"

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

function decisionFiles(projectDir: string): string[] {
  const directory = join(projectDir, DECISIONS_DIR)
  return existsSync(directory) ? readdirSync(directory).filter((name) => /^D-\d{8}-\d+-.*\.md$/.test(name)) : []
}

function nextId(projectDir: string, now: Date): string {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "")
  const taken = decisionFiles(projectDir)
    .map((name) => new RegExp(`^D-${day}-(\\d+)-`).exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
  return `D-${day}-${Math.max(0, ...taken) + 1}`
}

export function findDecisionFile(projectDir: string, id: string): string | undefined {
  const name = decisionFiles(projectDir).find((file) => file.startsWith(`${id}-`))
  return name === undefined ? undefined : join(DECISIONS_DIR, name)
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

function sessionPointer(origin: DecisionOrigin): string | undefined {
  if (!origin.sessionId) return undefined
  return origin.messageId ? `${origin.sessionId} → ${origin.messageId}` : origin.sessionId
}

function renderRecord(id: string, date: string, input: DecisionInput, evidence: readonly (VerifiedCitation & { note?: string })[], origin: DecisionOrigin): string {
  const pointer = sessionPointer(origin)
  const frontmatter = [
    "---",
    `id: ${id}`,
    `title: ${quote(input.title)}`,
    "status: active",
    `date: ${date}`,
    `reversibility: ${input.reversibility}`,
    ...(input.supersedes ? [`supersedes: ${input.supersedes}`] : []),
    ...(origin.agent ? [`agent: ${quote(origin.agent)}`] : []),
    ...(origin.sessionId ? [`session: ${[origin.sessionId, origin.messageId].filter(Boolean).join("/")}`] : []),
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

function renderPlanEntry(id: string, recordPath: string, input: DecisionInput, evidence: readonly VerifiedCitation[], origin: DecisionOrigin): string {
  const pointer = sessionPointer(origin)
  return [
    `### ${id}: ${input.title}`,
    `- **Context:** ${input.context}`,
    `- **Options considered:** ${input.options.join(" · ")}`,
    `- **Decision:** ${input.decision}`,
    `- **Reason:** ${input.reason}`,
    `- **Reversibility:** ${input.reversibility}`,
    `- **Evidence:** ${evidence.map((item) => `\`${item.ref}\``).join(", ")}`,
    ...(pointer ? [`- **Evidence session:** \`${pointer}\``] : []),
    `- **Record:** \`${recordPath}\``,
    "",
  ].join("\n")
}

/** Inserts the entry at the end of the plan's "## Decisions log" section (created if missing). */
function appendToPlan(planFile: string, entry: string): void {
  const lines = readFileSync(planFile, "utf-8").split("\n")
  const heading = lines.findIndex((line) => /^##\s+Decisions log\s*$/i.test(line))
  if (heading === -1) {
    writeFileSync(planFile, `${lines.join("\n").replace(/\n*$/, "")}\n\n## Decisions log\n\n${entry}`)
    return
  }
  const next = lines.findIndex((line, index) => index > heading && /^##\s/.test(line))
  const insertAt = next === -1 ? lines.length : next
  lines.splice(insertAt, 0, entry)
  writeFileSync(planFile, lines.join("\n"))
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

  const oldPath = input.supersedes ? findDecisionFile(context.projectDir, input.supersedes) : undefined
  if (input.supersedes && !oldPath) problems.push(`supersedes ${input.supersedes}: no such decision in ${DECISIONS_DIR}`)
  const plan = input.planPath ? resolvePlan(context.projectDir, input.planPath) : undefined
  if (Array.isArray(plan)) problems.push(...plan)
  if (problems.length > 0) return { ok: false, problems }

  const id = nextId(context.projectDir, now)
  const path = join(DECISIONS_DIR, `${id}-${slugify(input.title)}.md`)
  mkdirSync(join(context.projectDir, DECISIONS_DIR), { recursive: true })
  writeFileSync(join(context.projectDir, path), renderRecord(id, now.toISOString().slice(0, 10), input, verified, origin))
  if (oldPath) markSuperseded(context.projectDir, oldPath, id)
  if (typeof plan === "string") appendToPlan(plan, renderPlanEntry(id, path, input, verified, origin))

  const notes: string[] = []
  if (input.reversibility === "hard") notes.push("Reversibility is hard: this is an ADR candidate (promote it to docs/adr/ when the task closes).")
  if (oldPath) notes.push(`${input.supersedes} is now marked superseded by ${id}.`)
  if (!origin.sessionId) notes.push("No session pointer was available for this decision.")
  return { ok: true, id, path, ...(typeof plan === "string" ? { planPath: relative(context.projectDir, plan) } : {}), notes }
}
