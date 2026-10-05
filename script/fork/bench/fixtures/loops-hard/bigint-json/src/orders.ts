import { formatId } from "./ids"

export type Order = { readonly id: string; readonly total: number }

type RawOrder = { readonly id: number; readonly total: number }

export function parseOrders(body: string): Order[] {
  const raw = JSON.parse(body) as RawOrder[]
  return raw.map((order) => ({ id: formatId(order.id), total: order.total }))
}

export function orderUrl(order: Order): string {
  return `/dashboard/orders/${encodeURIComponent(order.id)}`
}
