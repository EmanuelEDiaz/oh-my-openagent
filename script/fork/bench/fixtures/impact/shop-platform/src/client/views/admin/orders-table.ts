import { priceLabel } from "../../format/money"
import type { OrderView } from "../../sdk/orders"
import { ORDER_TABLE_COLUMNS } from "./columns"

function cell(order: OrderView, field: string, money: boolean): string {
  const value = (order as Record<string, unknown>)[field]
  if (value === null || value === undefined) return ""
  return money ? priceLabel(Number(value)) : String(value)
}

/** Pipe-separated table: a header row, then one row per order. */
export function renderOrdersTable(orders: readonly OrderView[]): string {
  const header = ORDER_TABLE_COLUMNS.map((column) => column.header).join(" | ")
  const rows = orders.map((order) => ORDER_TABLE_COLUMNS.map((column) => cell(order, column.field, column.money === true)).join(" | "))
  return [header, ...rows].join("\n")
}
