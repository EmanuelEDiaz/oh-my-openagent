export type Env = Readonly<Record<string, string | undefined>>

export function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return Boolean(value)
}
