import { config } from "../config/config"
import { selectAll } from "../db/query"
import { toCsv } from "./csv"

/** Raw orders for accounting: the configured columns, straight from the table. */
export function exportOrdersCsv(): string {
  const columns = config.export.orderColumns
  const rows = selectAll("orders").map((record) => columns.map((column) => (record as Record<string, unknown>)[column]))
  return toCsv(columns, rows)
}
