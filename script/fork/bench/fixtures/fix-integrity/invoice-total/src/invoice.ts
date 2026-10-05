import { sumBy } from "./sum"

export type Line = {
  readonly sku: string
  readonly quantity: number
  readonly unitPrice: number
  /** `quantity × unitPrice` with two decimals, as printed on the invoice. */
  readonly amount: string
}

export function parseLines(csv: string): Line[] {
  const rows = csv.trim().split("\n").slice(1).filter((row) => row.trim() !== "")
  return rows.map((row) => {
    const [sku = "", quantity = "0", unitPrice = "0"] = row.split(",").map((cell) => cell.trim())
    const line = { sku, quantity: Number(quantity), unitPrice: Number(unitPrice) }
    return { ...line, amount: lineTotal(line).toFixed(2) }
  })
}

export function lineTotal(line: Pick<Line, "quantity" | "unitPrice">): number {
  return line.quantity * line.unitPrice
}

export function invoiceTotal(lines: readonly Line[]): number {
  return Math.round(sumBy(lines, "amount") * 100) / 100
}

export function totalQuantity(lines: readonly Line[]): number {
  return sumBy(lines, "quantity")
}
