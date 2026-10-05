export type Discount = { readonly kind: "percent" | "fixed"; readonly amount: number }

export const DISCOUNTS: Readonly<Record<string, Discount>> = {
  SAVE10: { kind: "percent", amount: 10 },
  FIVEOFF: { kind: "fixed", amount: 500 },
}

export function applyDiscount(subtotal: number, code: string | undefined): number {
  const discount = code === undefined ? undefined : DISCOUNTS[code]
  if (!discount) return subtotal
  return Math.max(0, subtotal - discount.amount)
}
