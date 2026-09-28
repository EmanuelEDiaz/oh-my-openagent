import type { DecisionRecord, InvalidDecision } from "./decision-files"

export type DecisionFilter = {
  readonly status?: "active" | "superseded" | "all"
  readonly area?: string
  /** Decisions whose file evidence cites this path (or a file inside it). */
  readonly file?: string
}

export function filterDecisions(records: readonly DecisionRecord[], filter: DecisionFilter): DecisionRecord[] {
  const status = filter.status ?? "active"
  const file = filter.file?.replace(/^\.\//, "").replace(/\/+$/, "")
  return records.filter((record) =>
    (status === "all" || record.status === status)
    && (!filter.area || record.area === filter.area)
    && (!file || record.evidence.some((item) => item.type === "file" && (item.ref === file || item.ref.startsWith(`${file}:`) || item.ref.startsWith(`${file}/`)))))
}

/** Supersession chains oldest → newest, e.g. "D-1 → D-3 → D-7". */
export function supersessionChains(records: readonly DecisionRecord[]): string[] {
  const byId = new Map(records.map((record) => [record.id, record]))
  return records
    .filter((record) => record.supersededBy && !record.supersedes)
    .map((start) => {
      const chain = [start.id]
      let current = start
      while (current.supersededBy && byId.has(current.supersededBy) && !chain.includes(current.supersededBy)) {
        current = byId.get(current.supersededBy)!
        chain.push(current.id)
      }
      return chain.join(" → ")
    })
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value.slice(0, width - 1)}~` : value.padEnd(width)
}

export function formatDecisionView(all: readonly DecisionRecord[], shown: readonly DecisionRecord[], invalid: readonly InvalidDecision[]): string {
  const lines: string[] = []
  if (shown.length === 0) lines.push("No decisions match.")
  else {
    lines.push(`${pad("ID", 15)}${pad("Date", 12)}${pad("Status", 12)}${pad("Revers.", 9)}${pad("Area", 12)}Title`)
    for (const record of [...shown].sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id, undefined, { numeric: true }))) {
      lines.push(`${pad(record.id, 15)}${pad(record.date, 12)}${pad(record.status, 12)}${pad(record.reversibility, 9)}${pad(record.area ?? "-", 12)}${record.title}`)
    }
  }
  const chains = supersessionChains(all)
  if (chains.length > 0) lines.push("", "Supersession chains:", ...chains.map((chain) => `  ${chain}`))
  if (invalid.length > 0) lines.push("", "Malformed records (fix them so they are searchable and linked):", ...invalid.map((record) => `  ${record.path}: ${record.problems.join("; ")}`))
  lines.push("", `${shown.length} shown of ${all.length} valid record(s).`)
  return lines.join("\n")
}
