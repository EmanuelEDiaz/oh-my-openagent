import { parseCsv } from "./csv"

export type Entry = { readonly date: string; readonly category: string; readonly amount: number }

export function toEntries(text: string): Entry[] {
  return parseCsv(text).map((row) => ({
    date: row.date ?? "",
    category: (row.category ?? "uncategorised").trim(),
    amount: Number(row.amount),
  }))
}

export function totalsByCategory(text: string): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const entry of toEntries(text)) totals[entry.category] = (totals[entry.category] ?? 0) + entry.amount
  return totals
}
