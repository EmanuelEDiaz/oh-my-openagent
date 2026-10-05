import { applyDiscount } from "./pricing.js"

export type Line = { readonly sku: string; readonly cents: number; readonly qty: number }
export type Cart = { readonly lines: readonly Line[]; readonly code?: string }

export function checkoutTotal(cart: Cart): number {
  const subtotal = cart.lines.reduce((sum, line) => sum + line.cents * line.qty, 0)
  return applyDiscount(subtotal, cart.code)
}
