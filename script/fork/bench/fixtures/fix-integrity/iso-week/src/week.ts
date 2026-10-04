export function isoWeek(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1)
  return Math.floor((date.getTime() - start) / (7 * 86_400_000)) + 1
}
