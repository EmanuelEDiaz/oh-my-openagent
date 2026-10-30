import type { CustomerRecord, OrderItemRecord, OrderRecord, ProductRecord } from "./tables"

export const customers: CustomerRecord[] = [
  { id: "c1", name: "Ada Lovelace", email: "ada@example.com" },
  { id: "c2", name: "Linus Torvalds", email: "linus@example.com" },
  { id: "c3", name: "Grace Hopper", email: "grace@example.com" },
]

export const products: ProductRecord[] = [
  { id: "p1", title: "Keyboard", price_cents: 1250 },
  { id: "p2", title: "Monitor", price_cents: 4999 },
  { id: "p3", title: "Cable", price_cents: 300 },
]

export const orders: OrderRecord[] = [
  { id: "o1", customer_id: "c1", status: "paid", total_cents: 1250, discount_code: null, created_at: "2026-10-01T09:00:00Z" },
  { id: "o2", customer_id: "c2", status: "pending", total_cents: 4999, discount_code: "WELCOME10", created_at: "2026-10-05T12:30:00Z" },
  { id: "o3", customer_id: "c3", status: "shipped", total_cents: 300, discount_code: null, created_at: "2026-10-07T16:45:00Z" },
]

export const orderItems: OrderItemRecord[] = [
  { order_id: "o1", product_id: "p1", quantity: 1 },
  { order_id: "o2", product_id: "p2", quantity: 1 },
  { order_id: "o3", product_id: "p3", quantity: 1 },
]
