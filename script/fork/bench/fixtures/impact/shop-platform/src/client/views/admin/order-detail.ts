import { dayOf } from "../../format/date"
import { priceLabel } from "../../format/money"
import type { OrderView } from "../../sdk/orders"

/** What support sees for one order. */
export function renderAdminOrder(order: OrderView): string {
  return [
    `Order ${order.id} (${order.status})`,
    `Customer: ${order.customer}`,
    `Placed: ${dayOf(order.placedAt)}`,
    `Total: ${priceLabel(order.total)}; payable: ${priceLabel(order.payable)}`,
    `Items: ${order.items.map((item) => `${item.quantity} x ${item.title}`).join(", ")}`,
  ].join("\n")
}
