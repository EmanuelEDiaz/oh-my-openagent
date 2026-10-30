import type { Customer } from "../domain/customer"
import type { OrderSummary } from "../services/order-service"

/** Domain field → JSON field sent by the API. */
export const ORDER_WIRE: ReadonlyArray<readonly [keyof OrderSummary, string]> = [
  ["id", "id"],
  ["customerId", "customer_id"],
  ["customerName", "customer_name"],
  ["status", "status"],
  ["totalCents", "total_cents"],
  ["payableCents", "payable_cents"],
  ["discountCode", "discount_code"],
  ["createdAt", "created_at"],
  ["items", "items"],
]

export const CUSTOMER_WIRE: ReadonlyArray<readonly [keyof Customer, string]> = [
  ["id", "id"],
  ["name", "name"],
  ["email", "email"],
]

export function toWire<T>(value: T, fields: ReadonlyArray<readonly [keyof T, string]>): Record<string, unknown> {
  return Object.fromEntries(fields.map(([field, name]) => [name, value[field]]))
}
