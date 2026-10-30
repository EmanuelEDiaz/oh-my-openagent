import type { Order } from "../domain/order"

/** Domain field → database column of `orders`. */
export const ORDER_COLUMNS = {
  id: "id",
  customerId: "customer_id",
  status: "status",
  totalCents: "total_cents",
  discountCode: "discount_code",
  createdAt: "created_at",
} as const satisfies Record<keyof Order, string>
