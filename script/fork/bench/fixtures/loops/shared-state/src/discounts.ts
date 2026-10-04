export type Discount = { readonly code: string; readonly percent: number }

export const NO_DISCOUNTS: Discount[] = []

export function applyDiscounts(cents: number, discounts: readonly Discount[]): number {
  let total = cents
  for (const discount of discounts) total = Math.round(total * (1 - discount.percent / 100))
  return total
}
