import { applyDiscounts, NO_DISCOUNTS, type Discount } from "./discounts"

export type PricerOptions = { readonly discounts?: Discount[] }

export function createPricer(options: PricerOptions = {}) {
  const discounts = options.discounts ?? NO_DISCOUNTS
  return {
    addDiscount(discount: Discount): void {
      if (discount.percent <= 0 || discount.percent > 100) throw new RangeError(`bad discount ${discount.code}`)
      discounts.push(discount)
    },
    total(cents: number): number {
      return applyDiscounts(cents, discounts)
    },
  }
}
