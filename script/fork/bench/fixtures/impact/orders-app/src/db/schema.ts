export type OrderStatus = "pending" | "paid" | "shipped"

/** One row of the orders table. Money is in cents. */
export type OrderRow = {
  id: string
  customer: string
  status: OrderStatus
  total: number
  /** Deprecated: discounts moved to the billing service. */
  discountCode: string | null
}
