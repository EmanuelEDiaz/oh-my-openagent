/** Client-side price label: 1250 → "$12.50". */
export function priceLabel(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
