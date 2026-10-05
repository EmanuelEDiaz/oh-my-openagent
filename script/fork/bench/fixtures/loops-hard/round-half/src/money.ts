export function round2(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function formatEuro(amount: number): string {
  return `€${round2(amount).toFixed(2)}`
}
