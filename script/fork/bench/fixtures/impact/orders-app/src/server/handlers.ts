import type { OrderStatus } from "../db/schema"
import { findOrder, listOrders } from "../db/store"

/** What the API sends for one order. */
export type OrderDto = {
  id: string
  customer: string
  status: OrderStatus
  total: number
  discountCode: string | null
}

function toDto(row: { id: string; customer: string; status: OrderStatus; total: number; discountCode: string | null }): OrderDto {
  return { id: row.id, customer: row.customer, status: row.status, total: row.total, discountCode: row.discountCode }
}

export function getOrder(id: string): OrderDto | undefined {
  const row = findOrder(id)
  return row ? toDto(row) : undefined
}

export function getOrders(): OrderDto[] {
  return listOrders().map(toDto)
}
