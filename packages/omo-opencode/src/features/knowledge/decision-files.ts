import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

export const DECISIONS_DIR = "docs/decisions"
/** Past this many records, new decisions go to docs/decisions/<year>/ so no directory grows unbounded. */
export const YEAR_FOLDER_THRESHOLD = 200

const DECISION_FILE = /^D-\d{8}-\d+-.*\.md$/
const REQUIRED = ["id", "title", "status", "date", "reversibility", "evidence"] as const

export type DecisionEvidence = { readonly type: string; readonly ref: string; readonly fingerprint?: string; readonly note?: string }

export type DecisionRecord = {
  readonly path: string
  readonly id: string
  readonly title: string
  readonly status: string
  readonly date: string
  readonly reversibility: string
  readonly area?: string
  readonly supersedes?: string
  readonly supersededBy?: string
  readonly plans: readonly string[]
  readonly evidence: readonly DecisionEvidence[]
  /** The "- **Decision:** …" line of the body, when present. */
  readonly decision?: string
  /** ses_…/msg_… where the decision was recorded, when known. */
  readonly session?: string
}

export type InvalidDecision = { readonly path: string; readonly problems: readonly string[] }

function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch {
      return trimmed
    }
  }
  return trimmed
}

/** Parses the frontmatter this plugin writes (a small YAML subset: scalars, string lists, evidence objects). */
export function parseDecision(path: string, content: string): DecisionRecord | InvalidDecision {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content)
  if (!match?.[1]) return { path, problems: ["missing frontmatter (--- … ---)"] }
  const scalars: Record<string, string> = {}
  const plans: string[] = []
  const evidence: Record<string, string>[] = []
  let list: "plans" | "evidence" | undefined
  for (const line of match[1].split("\n")) {
    const top = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (top?.[1] !== undefined) {
      list = top[2] === "" && (top[1] === "plans" || top[1] === "evidence") ? top[1] : undefined
      if (top[2] !== "" || list === undefined) scalars[top[1]] = unquote(top[2] ?? "")
      if (list) scalars[top[1]] = "[list]"
      continue
    }
    const item = /^\s{2}-\s+(.*)$/.exec(line)
    if (item?.[1] !== undefined && list === "plans") plans.push(unquote(item[1]))
    else if (item?.[1] !== undefined && list === "evidence") {
      const field = /^([a-z_]+):\s*(.*)$/.exec(item[1])
      evidence.push(field?.[1] ? { [field[1]]: unquote(field[2] ?? "") } : {})
    } else {
      const field = /^\s{4}([a-z_]+):\s*(.*)$/.exec(line)
      const last = evidence.at(-1)
      if (field?.[1] && last && list === "evidence") last[field[1]] = unquote(field[2] ?? "")
    }
  }
  const problems = REQUIRED.filter((key) => scalars[key] === undefined || scalars[key] === "").map((key) => `missing "${key}"`)
  if (scalars["evidence"] === "[list]" && evidence.length === 0) problems.push("evidence list is empty")
  if (scalars["status"] && !["active", "superseded"].includes(scalars["status"])) problems.push(`unknown status "${scalars["status"]}"`)
  const invalidEvidence = evidence.filter((item) => !item["type"] || !item["ref"]).length
  if (invalidEvidence > 0) problems.push(`${invalidEvidence} evidence item(s) without type/ref`)
  if (problems.length > 0) return { path, problems }
  const decisionLine = /^- \*\*Decision:\*\* (.+)$/m.exec(content.slice(match[0].length))?.[1]
  return {
    ...(decisionLine ? { decision: decisionLine.trim() } : {}),
    path,
    id: scalars["id"]!,
    title: scalars["title"]!,
    status: scalars["status"]!,
    date: scalars["date"]!,
    reversibility: scalars["reversibility"]!,
    ...(scalars["area"] ? { area: scalars["area"] } : {}),
    ...(scalars["supersedes"] ? { supersedes: scalars["supersedes"] } : {}),
    ...(scalars["superseded_by"] ? { supersededBy: scalars["superseded_by"] } : {}),
    ...(scalars["session"] ? { session: scalars["session"] } : {}),
    plans,
    evidence: evidence.map((item) => ({
      type: item["type"]!,
      ref: item["ref"]!,
      ...(item["fingerprint"] ? { fingerprint: item["fingerprint"] } : {}),
      ...(item["note"] ? { note: item["note"] } : {}),
    })),
  }
}

export function isInvalid(record: DecisionRecord | InvalidDecision): record is InvalidDecision {
  return "problems" in record
}

/** Relative paths of every decision file, flat or inside year folders. */
export function decisionPaths(projectDir: string): string[] {
  const root = join(projectDir, DECISIONS_DIR)
  if (!existsSync(root)) return []
  const found: string[] = []
  for (const entry of readdirSync(root)) {
    const absolute = join(root, entry)
    if (/^\d{4}$/.test(entry) && statSync(absolute).isDirectory()) {
      for (const nested of readdirSync(absolute)) if (DECISION_FILE.test(nested)) found.push(relative(projectDir, join(absolute, nested)))
    } else if (DECISION_FILE.test(entry)) found.push(relative(projectDir, absolute))
  }
  return found.sort()
}

export function loadDecisions(projectDir: string): { readonly valid: DecisionRecord[]; readonly invalid: InvalidDecision[] } {
  const valid: DecisionRecord[] = []
  const invalid: InvalidDecision[] = []
  for (const path of decisionPaths(projectDir)) {
    const parsed = parseDecision(path, readFileSync(join(projectDir, path), "utf-8"))
    if (isInvalid(parsed)) invalid.push(parsed)
    else valid.push(parsed)
  }
  return { valid, invalid }
}

/** Directory (relative) where a new decision dated `year` is written. */
export function decisionDirectoryFor(projectDir: string, year: string): string {
  return decisionPaths(projectDir).length >= YEAR_FOLDER_THRESHOLD ? `${DECISIONS_DIR}/${year}` : DECISIONS_DIR
}

/** Adds a plan path to a decision's `plans:` list (creating the list if needed). */
export function addPlanToDecision(projectDir: string, decisionPath: string, planPath: string): void {
  const absolute = join(projectDir, decisionPath)
  const content = readFileSync(absolute, "utf-8")
  const parsed = parseDecision(decisionPath, content)
  if (isInvalid(parsed) || parsed.plans.includes(planPath)) return
  const entry = `  - ${JSON.stringify(planPath)}`
  const updated = /^plans:\s*$/m.test(content)
    ? content.replace(/^plans:\s*$/m, `plans:\n${entry}`)
    : content.replace(/^evidence:\s*$/m, `plans:\n${entry}\nevidence:`)
  writeFileSync(absolute, updated)
}
