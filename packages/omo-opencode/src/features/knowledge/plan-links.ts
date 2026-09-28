import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { addPlanToDecision, loadDecisions } from "./decision-files"
import type { DecisionRecord } from "./decision-files"

export const BLOCK_START = "<!-- omo:decisions:start (generated from docs/decisions — do not edit) -->"
export const BLOCK_END = "<!-- omo:decisions:end -->"
const PLAN_DIRECTORIES = ["plans", ".omo/plans"]
const LEGACY_RECORD_LINE = /^- \*\*Record:\*\* `(docs\/decisions\/[^`]+)`/m

export function renderBlock(decisions: readonly DecisionRecord[]): string {
  const lines = [...decisions]
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }))
    .map((decision) => decision.status === "superseded"
      ? `- ~~${decision.id} — ${decision.title}~~ · superseded${decision.supersededBy ? ` by ${decision.supersededBy}` : ""} · \`${decision.path}\``
      : `- ${decision.id} — ${decision.title} · ${decision.status} · ${decision.reversibility}${decision.area ? ` · ${decision.area}` : ""} · \`${decision.path}\``)
  return [BLOCK_START, ...(lines.length > 0 ? lines : ["- (no decisions recorded yet)"]), BLOCK_END].join("\n")
}

/** Splits the plan into lines, dropping full decision entries written by plugin 1.4 (they carry a **Record:** line). */
function withoutLegacyEntries(lines: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < lines.length; index++) {
    if (/^### D-\d{8}-\d+:/.test(lines[index] ?? "")) {
      const end = lines.findIndex((line, next) => next > index && /^#{2,3}\s/.test(line))
      const entry = lines.slice(index, end === -1 ? lines.length : end)
      if (entry.some((line) => LEGACY_RECORD_LINE.test(line))) {
        index = (end === -1 ? lines.length : end) - 1
        continue
      }
    }
    result.push(lines[index] ?? "")
  }
  return result
}

/** Replaces (or creates) the generated block; text outside the markers is left untouched. */
export function upsertPlanBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_START)
  const end = content.indexOf(BLOCK_END)
  if (start !== -1 && end > start) return content.slice(0, start) + block + content.slice(end + BLOCK_END.length)
  const lines = withoutLegacyEntries(content.split("\n"))
  const heading = lines.findIndex((line) => /^##\s+Decisions log\s*$/i.test(line))
  if (heading === -1) return `${lines.join("\n").replace(/\n*$/, "")}\n\n## Decisions log\n\n${block}\n`
  const insertAt = lines[heading + 1] === "" ? heading + 2 : heading + 1
  lines.splice(insertAt, 0, block, "")
  return lines.join("\n").replace(/\n{3,}/g, "\n\n")
}

function planFiles(projectDir: string): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry)
      if (statSync(absolute).isDirectory()) walk(absolute)
      else if (entry.endsWith(".md")) found.push(relative(projectDir, absolute))
    }
  }
  for (const directory of PLAN_DIRECTORIES) walk(join(projectDir, directory))
  return found
}

/** Records which plans quoted a decision in the 1.4 format so their blocks can be regenerated. */
function migrateLegacyReferences(projectDir: string): void {
  for (const plan of planFiles(projectDir)) {
    const content = readFileSync(join(projectDir, plan), "utf-8")
    for (const match of content.matchAll(new RegExp(LEGACY_RECORD_LINE.source, "gm"))) {
      if (match[1] && existsSync(join(projectDir, match[1]))) addPlanToDecision(projectDir, match[1], plan)
    }
  }
}

/** Regenerates the decisions block of every plan referenced by a decision; returns the plans rewritten. */
export function refreshPlanLinks(projectDir: string): string[] {
  migrateLegacyReferences(projectDir)
  const { valid } = loadDecisions(projectDir)
  const byPlan = new Map<string, DecisionRecord[]>()
  for (const decision of valid) {
    for (const plan of decision.plans) byPlan.set(plan, [...(byPlan.get(plan) ?? []), decision])
  }
  const rewritten: string[] = []
  for (const [plan, decisions] of byPlan) {
    const absolute = join(projectDir, plan)
    if (!existsSync(absolute)) continue
    const before = readFileSync(absolute, "utf-8")
    const after = upsertPlanBlock(before, renderBlock(decisions))
    if (after !== before) {
      writeFileSync(absolute, after)
      rewritten.push(plan)
    }
  }
  return rewritten
}
