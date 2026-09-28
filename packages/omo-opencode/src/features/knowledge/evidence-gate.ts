import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, relative, resolve } from "node:path"

import { checkCitations, scanCitations } from "./citation-scan"
import type { CitationContext } from "./citations"

export type EvidenceGateMode = "block" | "warn" | "off"

export type CheckboxViolation = { readonly label: string; readonly reason: string }

const CHECKBOX = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/

export function isPlanFile(relativePath: string): boolean {
  return relativePath.endsWith(".md") && (relativePath.startsWith("plans/") || relativePath.startsWith(".omo/plans/"))
}

type Checkbox = { readonly label: string; readonly checked: boolean; readonly block: string }

function checkboxes(content: string): Checkbox[] {
  const lines = content.split("\n")
  const result: Checkbox[] = []
  lines.forEach((line, index) => {
    const match = CHECKBOX.exec(line)
    if (!match) return
    const indent = match[1]?.length ?? 0
    const body = [line]
    for (let next = index + 1; next < lines.length; next++) {
      const candidate = lines[next] ?? ""
      if (candidate.trim() === "") break
      const candidateIndent = candidate.length - candidate.trimStart().length
      if (candidateIndent <= indent || CHECKBOX.test(candidate)) break
      body.push(candidate)
    }
    result.push({ label: (match[3] ?? "").replace(/\s+[—–-]\s+evid.*$/i, "").trim(), checked: match[2] !== " ", block: body.join("\n") })
  })
  return result
}

/**
 * Checkboxes that became checked in `after` must carry at least one verifiable, valid citation on
 * their line or the indented lines right below (file:line, evidence file path, commit, chat locator).
 */
export function newlyCheckedViolations(before: string, after: string, context: CitationContext): CheckboxViolation[] {
  const wasChecked = new Set(checkboxes(before).filter((item) => item.checked).map((item) => item.label))
  const violations: CheckboxViolation[] = []
  for (const item of checkboxes(after)) {
    if (!item.checked || wasChecked.has(item.label)) continue
    const checks = checkCitations(scanCitations(item.block, { includePlainFiles: true }), context)
    const invalid = checks.filter((check) => !check.ok)
    if (invalid.length > 0) {
      violations.push({ label: item.label, reason: `invalid evidence: ${invalid.map((check) => `${check.ref} (${check.reason})`).join(", ")}` })
    } else if (checks.length === 0) {
      violations.push({ label: item.label, reason: "no verifiable evidence (add e.g. `tests/x.test.ts:12-30`, `commit:<sha>`, an evidence file path or ses_…/msg_…)" })
    }
  }
  return violations
}

type ToolArgs = Record<string, unknown>

function applyEdit(content: string, oldString: unknown, newString: unknown, replaceAll: unknown): string | undefined {
  if (typeof oldString !== "string" || typeof newString !== "string") return undefined
  if (oldString === "") return newString
  if (!content.includes(oldString)) return undefined
  return replaceAll === true ? content.split(oldString).join(newString) : content.replace(oldString, newString)
}

/** Resulting file content of a write/edit/multiedit call, or undefined when it cannot be computed safely. */
export function resultingContent(tool: string, args: ToolArgs, current: string): string | undefined {
  if (tool === "write") return typeof args["content"] === "string" ? args["content"] : undefined
  if (tool === "edit") return applyEdit(current, args["oldString"], args["newString"], args["replaceAll"])
  if (tool === "multiedit" && Array.isArray(args["edits"])) {
    let content: string | undefined = current
    for (const edit of args["edits"] as ToolArgs[]) {
      if (content === undefined) return undefined
      content = applyEdit(content, edit["oldString"], edit["newString"], edit["replaceAll"])
    }
    return content
  }
  return undefined
}

export type GateEvaluation = { readonly planPath: string; readonly violations: readonly CheckboxViolation[] }

export function evaluatePlanEdit(tool: string, args: ToolArgs, context: CitationContext): GateEvaluation | undefined {
  const filePath = args["filePath"] ?? args["path"]
  if (typeof filePath !== "string") return undefined
  const absolute = isAbsolute(filePath) ? filePath : resolve(context.projectDir, filePath)
  const planPath = relative(context.projectDir, absolute).split("\\").join("/")
  if (!isPlanFile(planPath)) return undefined
  const before = existsSync(absolute) ? readFileSync(absolute, "utf-8") : ""
  const after = resultingContent(tool, args, before)
  if (after === undefined) return undefined
  return { planPath, violations: newlyCheckedViolations(before, after, context) }
}

export function formatGateMessage(evaluation: GateEvaluation, mode: EvidenceGateMode): string {
  const items = evaluation.violations.map((violation) => `- "${violation.label}": ${violation.reason}`).join("\n")
  const head = mode === "block"
    ? `[evidence-gate] Not saved: ${evaluation.planPath} marks tasks done without verifiable evidence.`
    : `[evidence-gate] Warning: ${evaluation.planPath} marks tasks done without verifiable evidence.`
  return `${head}\n${items}\nA task is done only when its criterion passed: cite the proof on the checkbox line or right below it, e.g. \`- [x] 3. Cache — evidence: tests/cache.test.ts:12-30, commit:9b8f63f8e\`.`
}
