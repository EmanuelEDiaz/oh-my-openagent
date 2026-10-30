/** "2026-10-01T09:00:00Z" → "2026-10-01". */
export function dayOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10)
}
