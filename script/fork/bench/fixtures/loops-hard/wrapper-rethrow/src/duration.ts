const UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1000, m: 60_000 }

/** "30s" -> 30000, "1500ms" -> 1500, "2m" -> 120000 */
export function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)$/)
  if (!match) throw new Error(`bad duration ${value}`)
  return Number(match[1]) * (UNITS[match[2] ?? "s"] ?? 1000)
}
