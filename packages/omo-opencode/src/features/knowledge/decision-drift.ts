import { verifyCitation } from "./citations"
import type { CitationContext } from "./citations"
import { loadDecisions } from "./decision-files"

export type DriftFinding = { readonly id: string; readonly path: string; readonly ref: string; readonly problem: string }

/** Active decisions whose evidence no longer exists or whose cited lines changed since they were recorded. */
export function findDecisionDrift(context: CitationContext): DriftFinding[] {
  const findings: DriftFinding[] = []
  for (const record of loadDecisions(context.projectDir).valid.filter((item) => item.status === "active")) {
    for (const item of record.evidence) {
      if (item.type === "url") continue
      const now = verifyCitation(item.type as "file" | "commit" | "session", item.ref, context)
      if (!now.ok) findings.push({ id: record.id, path: record.path, ref: item.ref, problem: now.reason })
      else if (item.fingerprint && now.fingerprint && item.fingerprint !== now.fingerprint) {
        findings.push({ id: record.id, path: record.path, ref: item.ref, problem: "cited lines changed since the decision was recorded" })
      }
    }
  }
  return findings
}

export function formatDrift(findings: readonly DriftFinding[]): string {
  if (findings.length === 0) return "All active decisions: evidence still valid and unchanged."
  return [
    `${findings.length} evidence problem(s) in active decisions — re-check them, then supersede (decision_record) or fix the record:`,
    ...findings.map((finding) => `- ${finding.id} ${finding.ref}: ${finding.problem}  (${finding.path})`),
  ].join("\n")
}
