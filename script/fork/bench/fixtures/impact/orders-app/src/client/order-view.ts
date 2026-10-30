import { formatMoney } from "../shared/money"
import type { OrderView } from "./orders-api"

/** The order page, one line per field. */
export function renderOrder(order: OrderView): string[] {
  const lines = [`Order ${order.id}`, `Customer: ${order.customer}`, `Status: ${order.status}`, `Total: ${formatMoney(order.total)}`]
  if (order.discountCode) lines.push(`Discount: ${order.discountCode}`)
  return lines
}

/** The order list: one line per order. */
export function renderOrderList(orders: OrderView[]): string[] {
  return orders.map((order) => `${order.id} ${order.customer} ${order.status} ${formatMoney(order.total)}`)
}
