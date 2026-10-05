const DAY_MS = 86_400_000

export function parseDay(text: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new SyntaxError(`not a day: ${text}`)
  return new Date(`${text}T00:00:00`)
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(text: string, days: number): string {
  return formatDay(new Date(parseDay(text).getTime() + days * DAY_MS))
}
