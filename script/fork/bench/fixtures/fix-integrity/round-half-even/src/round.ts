export function roundHalfEven(x: number): number {
  return Math.round(x)
}

export function invoiceTotal(lines: readonly number[]): number {
  return lines.map(roundHalfEven).reduce((sum, line) => sum + line, 0)
}
