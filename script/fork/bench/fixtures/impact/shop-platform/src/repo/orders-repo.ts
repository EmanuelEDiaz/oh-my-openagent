import { selectAll, selectWhere } from "../db/query"
import type { OrderRecord } from "../db/tables"
import type { Order } from "../domain/order"
import { isOrderStatus } from "../domain/status"
import { ORDER_COLUMNS } from "./order-columns"

function toOrder(record: OrderRecord): Order {
  const row = record as Record<string, unknown>
  const order = Object.fromEntries(Object.entries(ORDER_COLUMNS).map(([field, column]) => [field, row[column]])) as Order
  if (!isOrderStatus(order.status)) throw new Error(`order ${order.id} has unknown status ${String(order.status)}`)
  return order
}

export function findOrder(id: string): Order | undefined {
  const [record] = selectWhere("orders", "id", id)
  return record === undefined ? undefined : toOrder(record)
}

export function listOrders(): Order[] {
  return selectAll("orders").map(toOrder)
}
