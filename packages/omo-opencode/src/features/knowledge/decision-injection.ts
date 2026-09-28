import { verifyCitation } from "./citations"
import { loadDecisions } from "./decision-files"
import type { DecisionRecord } from "./decision-files"

const MAX_PER_FILE = 3
const MAX_DECISION_CHARS = 200

export type FileDecision = { readonly record: DecisionRecord; readonly drift: string | undefined }

function evidencePath(ref: string): string {
  return ref.replace(/(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/, "").replace(/^\.\//, "").replace(/\/+$/, "")
}

/** Whether the lines a decision cites still match what was recorded (fingerprint) and still exist. */
export function evidenceDrift(projectDir: string, record: DecisionRecord, filePath: string): string | undefined {
  for (const item of record.evidence) {
    if (item.type !== "file" || evidencePath(item.ref) !== filePath) continue
    const now = verifyCitation("file", item.ref, { projectDir })
    if (!now.ok) return `cited ${item.ref} ${now.reason}`
    if (item.fingerprint && now.fingerprint && item.fingerprint !== now.fingerprint) return `cited lines ${item.ref} changed since it was recorded`
  }
  return undefined
}

/**
 * Active decisions whose file evidence cites `filePath` (or a directory containing it), most important
 * first: hard-to-reverse, then newest. At most three, so a file never drowns the tool output.
 */
export function decisionsForFile(projectDir: string, records: readonly DecisionRecord[], filePath: string): FileDecision[] {
  const normalized = filePath.replace(/^\.\//, "")
  const rank = (record: DecisionRecord): number => (record.reversibility === "hard" ? 0 : record.reversibility === "costly" ? 1 : 2)
  return records
    .filter((record) => record.status === "active")
    .filter((record) => record.evidence.some((item) => {
      if (item.type !== "file") return false
      const cited = evidencePath(item.ref)
      return cited === normalized || normalized.startsWith(`${cited}/`)
    }))
    .sort((left, right) => rank(left) - rank(right) || right.date.localeCompare(left.date) || right.id.localeCompare(left.id, undefined, { numeric: true }))
    .slice(0, MAX_PER_FILE)
    .map((record) => ({ record, drift: evidenceDrift(projectDir, record, normalized) }))
}

function clip(text: string): string {
  return text.length <= MAX_DECISION_CHARS ? text : `${text.slice(0, MAX_DECISION_CHARS)}…`
}

export function formatFileDecisions(filePath: string, decisions: readonly FileDecision[]): string {
  const lines = decisions.map(({ record, drift }) => [
    `- ${record.id} (${record.status}, ${record.reversibility}${record.area ? `, ${record.area}` : ""}): ${record.title}`,
    ...(record.decision ? [`  Decision: ${clip(record.decision)}`] : []),
    `  Record: ${record.path}`,
    ...(drift ? [`  WARNING: ${drift} — re-check before relying on it (supersede it with decision_record if it no longer holds).`] : []),
  ].join("\n"))
  return `[Decisions for ${filePath}]\nRecorded decisions apply to this file; follow them or supersede them explicitly with decision_record.\n${lines.join("\n")}`
}

export function loadActiveDecisions(projectDir: string): DecisionRecord[] {
  return loadDecisions(projectDir).valid.filter((record) => record.status === "active")
}
