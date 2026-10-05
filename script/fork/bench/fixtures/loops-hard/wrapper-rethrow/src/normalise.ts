import { parseDuration } from "./duration"

export type RawConfig = { readonly name?: unknown; readonly timeout?: number | string; readonly retries?: number }
export type Config = { readonly name: string; readonly timeoutMs: number; readonly retries: number }

export function normalise(raw: RawConfig): Config {
  if (typeof raw.name !== "string" || raw.name === "") throw new Error("config: name is required")
  const timeout = raw.timeout ?? "10s"
  return { name: raw.name, timeoutMs: parseDuration(timeout as string), retries: raw.retries ?? 3 }
}
