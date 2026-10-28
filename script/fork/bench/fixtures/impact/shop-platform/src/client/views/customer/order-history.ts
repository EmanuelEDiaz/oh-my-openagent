import { dayOf } from "../../format/date"
import { priceLabel } from "../../format/money"
import type { OrderView } from "../../sdk/orders"

/** One line per order: id, day, what was paid, status. */
export function renderOrderHistory(orders: readonly OrderView[]): string {
  return orders.map((order) => `${order.id}  ${dayOf(order.placedAt)}  ${priceLabel(order.payable)}  ${order.status}`).join("\n")
}
