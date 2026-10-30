import type { Order, OrderLine } from "../domain/order"
import { findCustomer } from "../repo/customers-repo"
import { linesOf } from "../repo/items-repo"
import { findOrder, listOrders } from "../repo/orders-repo"
import { payableCents } from "./pricing"

/** An order with what every reader of it needs: who placed it, what they pay and what they bought. */
export type OrderSummary = Order & { customerName: string; customerEmail: string; payableCents: number; items: OrderLine[] }

function summarize(order: Order): OrderSummary {
  const customer = findCustomer(order.customerId)
  return {
    ...order,
    customerName: customer?.name ?? "(unknown customer)",
    customerEmail: customer?.email ?? "",
    payableCents: payableCents(order),
    items: linesOf(order.id),
  }
}

export function getOrderSummary(id: string): OrderSummary | undefined {
  const order = findOrder(id)
  return order === undefined ? undefined : summarize(order)
}

export function listOrderSummaries(): OrderSummary[] {
  return listOrders().map(summarize)
}
