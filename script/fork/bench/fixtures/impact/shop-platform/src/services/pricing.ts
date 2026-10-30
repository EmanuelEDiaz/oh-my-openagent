import type { Order } from "../domain/order"

const DISCOUNTS: Readonly<Record<string, number>> = { WELCOME10: 0.1 }

/** What the customer pays: the total minus the discount of a known code, rounded to the cent. */
export function payableCents(order: Pick<Order, "totalCents" | "discountCode">): number {
  const rate = order.discountCode === null ? 0 : DISCOUNTS[order.discountCode] ?? 0
  return Math.round(order.totalCents * (1 - rate))
}
