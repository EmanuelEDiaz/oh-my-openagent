import { round2 } from "./money"

export type Line = { readonly unitPrice: number; readonly qty: number }

export function lineTotal(line: Line): number {
  return round2(line.unitPrice * line.qty)
}
