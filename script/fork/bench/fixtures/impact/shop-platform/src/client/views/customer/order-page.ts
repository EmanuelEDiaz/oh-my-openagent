import { dayOf } from "../../format/date"
import { priceLabel } from "../../format/money"
import type { OrderView } from "../../sdk/orders"

/** The customer's page for one order, as text lines. */
export function renderOrderPage(order: OrderView): string {
  const lines = [`Order ${order.id}`, `Placed: ${dayOf(order.placedAt)}`, `Status: ${order.status}`]
  for (const item of order.items) lines.push(`- ${item.quantity} x ${item.title}`)
  lines.push(`Total: ${priceLabel(order.total)}`)
  if (order.discount !== null) lines.push(`Discount: ${order.discount} (you pay ${priceLabel(order.payable)})`)
  return lines.join("\n")
}
