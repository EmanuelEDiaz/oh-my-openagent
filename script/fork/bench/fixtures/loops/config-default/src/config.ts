import { readLimitOverrides, type Env } from "./env"

export type Limits = { readonly maxTags: number; readonly maxTitleLength: number }

export const DEFAULT_LIMITS: Limits = { maxTags: 10, maxTitleLength: 40 }

export function loadLimits(env: Env = process.env): Limits {
  return { ...DEFAULT_LIMITS, ...readLimitOverrides(env) }
}
