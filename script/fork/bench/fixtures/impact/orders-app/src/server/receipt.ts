import { formatMoney } from "../shared/money"
import type { OrderDto } from "./handlers"

/** The line printed on the emailed receipt. */
export function receiptLine(order: OrderDto): string {
  return `Order ${order.id} for ${order.customer}: ${formatMoney(order.total)}`
}
