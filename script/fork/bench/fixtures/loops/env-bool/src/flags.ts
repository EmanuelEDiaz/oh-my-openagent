import { readBool, type Env } from "./env"

export const DEFAULT_FLAGS: Readonly<Record<string, boolean>> = { promo: true, newCheckout: false }

export function isEnabled(flag: string, env: Env = process.env): boolean {
  const variable = `FEATURE_${flag.replaceAll(/([a-z])([A-Z])/g, "$1_$2").toUpperCase()}`
  return readBool(env[variable], DEFAULT_FLAGS[flag] ?? false)
}
