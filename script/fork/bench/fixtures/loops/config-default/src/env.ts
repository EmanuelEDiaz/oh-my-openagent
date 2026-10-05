export type Env = Readonly<Record<string, string | undefined>>
export type LimitOverrides = { maxTags?: number; maxTitleLength?: number }

function intVar(value: string | undefined): number {
  return Number.parseInt(value ?? "", 10) || 0
}

export function readLimitOverrides(env: Env): LimitOverrides {
  return { maxTags: intVar(env.MAX_TAGS), maxTitleLength: intVar(env.MAX_TITLE_LENGTH) }
}
