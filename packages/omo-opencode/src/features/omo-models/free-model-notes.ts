/**
 * Facts about free tiers that are not exposed by any API, copied verbatim from the official docs.
 * They can change: every note carries its source and the date it was checked, and the UI shows both.
 */
export type FreeModelNote = {
  readonly text: string
  readonly source: string
  readonly checkedAt: string
}

const ZEN_DOCS = "https://opencode.ai/docs/zen/"
const OPENROUTER_LIMITS = "https://openrouter.ai/docs/api-reference/limits"
const CHECKED_AT = "2026-09-27"

const ZEN_LIMITED_TIME: FreeModelNote = {
  text: "Free on OpenCode Zen only for a limited time (providers use it to collect feedback).",
  source: ZEN_DOCS,
  checkedAt: CHECKED_AT,
}

/** Keyed by OpenCode Zen model id prefix; data policy per the Zen docs. */
const ZEN_DATA_POLICY: readonly (readonly [string, string])[] = [
  ["big-pickle", "Data: collected data may be used to improve the model during its free period."],
  ["space-bunny", "Data: zero-retention provider; your data is not used for training."],
  ["longcat", "Data: zero-retention provider; your data is not used for training."],
  ["nemotron", "Data: use is logged for security and to improve NVIDIA products and services."],
  ["muse-spark", "Data: grants permission to use prompts and completions to train future Meta models."],
]

const OPENROUTER_FREE_LIMITS: FreeModelNote = {
  text: "OpenRouter :free limits: 20 requests/min and 50 requests/day (1000/day after buying at least $10 of credits).",
  source: OPENROUTER_LIMITS,
  checkedAt: CHECKED_AT,
}

export function freeModelNotes(modelId: string): FreeModelNote[] {
  const slash = modelId.indexOf("/")
  const provider = modelId.slice(0, slash)
  const name = modelId.slice(slash + 1)
  if (provider === "openrouter" && name.endsWith(":free")) return [OPENROUTER_FREE_LIMITS]
  if (provider !== "opencode") return []
  const policy = ZEN_DATA_POLICY.find(([prefix]) => name.startsWith(prefix))
  const isFreeZen = name.endsWith("-free") || name === "big-pickle"
  if (!isFreeZen) return []
  return [
    ZEN_LIMITED_TIME,
    ...(policy === undefined ? [] : [{ text: policy[1], source: ZEN_DOCS, checkedAt: CHECKED_AT }]),
  ]
}
