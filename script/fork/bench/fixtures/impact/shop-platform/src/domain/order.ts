import type { OrderStatus } from "./status"

export type Order = {
  id: string
  customerId: string
  status: OrderStatus
  totalCents: number
  discountCode: string | null
  createdAt: string
}

export type OrderLine = { title: string; quantity: number }
