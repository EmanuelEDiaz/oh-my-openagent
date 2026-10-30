/** 1250 → "$12.50". */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}
