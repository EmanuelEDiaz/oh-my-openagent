import { isValidToken } from "./auth"

export type Decision = { readonly ok: true } | { readonly ok: false; readonly reason: string }

export function authorize(headers: Readonly<Record<string, string | undefined>>): Decision {
  const token = headers["x-token"]
  if (token === undefined) return { ok: false, reason: "missing token" }
  if (!isValidToken(token)) return { ok: false, reason: "invalid token" }
  return { ok: true }
}
