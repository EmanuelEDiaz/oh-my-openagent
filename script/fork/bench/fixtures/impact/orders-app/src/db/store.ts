import type { OrderRow } from "./schema"

const rows: OrderRow[] = [
  { id: "o1", customer: "Ada", status: "paid", total: 1250, discountCode: null },
  { id: "o2", customer: "Linus", status: "pending", total: 4999, discountCode: "WELCOME10" },
  { id: "o3", customer: "Grace", status: "shipped", total: 300, discountCode: null },
]

export function findOrder(id: string): OrderRow | undefined {
  return rows.find((row) => row.id === id)
}

export function listOrders(): OrderRow[] {
  return [...rows]
}
