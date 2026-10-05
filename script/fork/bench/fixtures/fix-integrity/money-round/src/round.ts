/** Rounds an amount of money to cents. See README.md for the tie rule. */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100
}

export function formatEuros(amount: number): string {
  return `${roundCents(amount).toFixed(2)} €`
}
