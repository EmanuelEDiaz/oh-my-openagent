const DAY_MS = 86_400_000

const pad = (value: number) => String(value).padStart(2, "0")

export function parseDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month, date))
}

export function formatDay(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export function addDays(day: string, n: number): string {
  return formatDay(new Date(parseDay(day).getTime() + n * DAY_MS))
}

export function nightsBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS)
}
