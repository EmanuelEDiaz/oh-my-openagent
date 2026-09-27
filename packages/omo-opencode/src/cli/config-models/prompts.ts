import * as p from "@clack/prompts"

import type { ChainAvailability } from "./agent-chains"
import { getAgentProfile } from "./agent-profiles"
import { formatChain, formatFocusHint, formatOptionLabel, formatRankingTable } from "./format"
import { suggestChain } from "./model-ranking"
import type { RankedModel } from "./model-ranking"

export type PickMode = "recommended" | "guided" | "search"

const SEARCH = "__search__"
const DONE = "__done__"
const SHORTLIST_SIZE = 8
const MAX_CHAIN = 4

function unlessCancelled<TValue>(value: TValue): Exclude<TValue, symbol> | null {
  if (p.isCancel(value)) {
    p.cancel("Model configuration cancelled.")
    return null
  }
  return value as Exclude<TValue, symbol>
}

function statusWord(status: ChainAvailability): string {
  if (status.models.length === 0) return "using omo defaults"
  if (status.firstAvailable === undefined) return "BROKEN: no model available"
  if (status.missing.length > 0) return `${status.missing.length} model(s) missing`
  return "ok"
}

export async function promptMode(): Promise<PickMode | null> {
  const value = await p.select<PickMode>({
    message: "How do you want to choose the models?",
    options: [
      { value: "recommended", label: "Recommended", hint: "I suggest a chain per agent, you accept or edit it" },
      { value: "guided", label: "Guided", hint: "pick the primary, then each fallback, from a short ranked list" },
      { value: "search", label: "Search all", hint: "search the full list and tick several models" },
    ],
    initialValue: "recommended",
  })
  return unlessCancelled(value)
}

export async function promptAgents(statuses: readonly ChainAvailability[]): Promise<string[] | null> {
  const value = await p.multiselect<string>({
    message: "Which agents? (space to tick, enter to continue; broken ones are pre-ticked)",
    options: statuses.map((status) => ({
      value: status.agent,
      label: `${status.agent.padEnd(18)} ${getAgentProfile(status.agent).summary}`,
      hint: statusWord(status),
    })),
    initialValues: statuses.filter((status) => status.missing.length > 0).map((status) => status.agent),
    required: true,
  })
  return unlessCancelled(value)
}

function showAgentHeader(agent: string, ranked: readonly RankedModel[], current: readonly string[]): void {
  const lines = [
    getAgentProfile(agent).role,
    "",
    current.length === 0 ? "Current: omo defaults" : `Current:\n${formatChain(current)}`,
    "",
    "Best matches (score 0-100, * = recommended by omo):",
    formatRankingTable(ranked, SHORTLIST_SIZE),
  ]
  p.note(lines.join("\n"), agent)
}

async function searchOne(ranked: readonly RankedModel[], exclude: readonly string[], message: string): Promise<string | null> {
  const value = await p.autocomplete<string>({
    message,
    options: ranked
      .filter((entry) => !exclude.includes(entry.model))
      .map((entry) => ({ value: entry.model, label: formatOptionLabel(entry), hint: formatFocusHint(entry) })),
    placeholder: "type part of the name, e.g. claude, gpt, free",
    maxItems: 10,
  })
  return unlessCancelled(value)
}

async function pickOne(params: {
  readonly ranked: readonly RankedModel[]
  readonly exclude: readonly string[]
  readonly message: string
  readonly allowDone: boolean
}): Promise<string | null> {
  const shortlist = params.ranked.filter((entry) => !params.exclude.includes(entry.model)).slice(0, SHORTLIST_SIZE)
  const options = [
    ...shortlist.map((entry) => ({ value: entry.model, label: formatOptionLabel(entry), hint: formatFocusHint(entry) })),
    { value: SEARCH, label: "Search all models..." },
    ...(params.allowDone ? [{ value: DONE, label: "Done, no more fallbacks" }] : []),
  ]
  const choice = unlessCancelled(await p.select<string>({ message: params.message, options }))
  if (choice === SEARCH) return searchOne(params.ranked, params.exclude, params.message)
  return choice
}

async function guidedChain(ranked: readonly RankedModel[]): Promise<string[] | null> {
  const chain: string[] = []
  while (chain.length < MAX_CHAIN) {
    const message = chain.length === 0
      ? "Primary model (used first)"
      : `Fallback ${chain.length} (used if the ones above fail)`
    const choice = await pickOne({ ranked, exclude: chain, message, allowDone: chain.length > 0 })
    if (choice === null) return null
    if (choice === DONE) break
    chain.push(choice)
  }
  return chain
}

async function searchChain(ranked: readonly RankedModel[], current: readonly string[]): Promise<string[] | null> {
  const available = new Set(ranked.map((entry) => entry.model))
  const selected = unlessCancelled(await p.autocompleteMultiselect<string>({
    message: "Tick the models to use (type to search, Tab to tick, Enter to confirm)",
    options: ranked.map((entry) => ({ value: entry.model, label: formatOptionLabel(entry), hint: formatFocusHint(entry) })),
    initialValues: current.filter((model) => available.has(model)),
    placeholder: "e.g. claude, gpt, free",
    maxItems: 10,
    required: true,
  }))
  if (selected === null) return null
  return promptOrder({ selected, preferred: current })
}

async function recommendedChain(ranked: readonly RankedModel[]): Promise<string[] | null> {
  const suggestion = suggestChain(ranked)
  p.note(
    `${formatChain(suggestion)}\n\nFallbacks come from different providers when possible,\nso one provider outage does not break the agent.`,
    "Suggested chain",
  )
  const decision = unlessCancelled(await p.select<"accept" | "edit" | "skip">({
    message: "Use this chain?",
    options: [
      { value: "accept", label: "Yes, use it" },
      { value: "edit", label: "No, let me pick (guided)" },
      { value: "skip", label: "Skip this agent (keep current)" },
    ],
    initialValue: "accept",
  }))
  if (decision === null) return null
  if (decision === "accept") return suggestion
  if (decision === "skip") return []
  return guidedChain(ranked)
}

/** Returns the ordered chain, [] to keep the agent unchanged, or null when cancelled. */
export async function promptChain(params: {
  readonly agent: string
  readonly mode: PickMode
  readonly ranked: readonly RankedModel[]
  readonly current: readonly string[]
}): Promise<string[] | null> {
  showAgentHeader(params.agent, params.ranked, params.current)
  if (params.mode === "recommended") return recommendedChain(params.ranked)
  if (params.mode === "guided") return guidedChain(params.ranked)
  return searchChain(params.ranked, params.current)
}

/** Clack multiselect returns options in list order, so the chain order is asked explicitly. */
export async function promptOrder(params: {
  readonly selected: readonly string[]
  readonly preferred: readonly string[]
}): Promise<string[] | null> {
  const rank = (model: string): number => {
    const index = params.preferred.indexOf(model)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const remaining = [...params.selected].sort((left, right) => rank(left) - rank(right))
  const ordered: string[] = []

  while (remaining.length > 1) {
    const position = ordered.length === 0 ? "Primary model (used first)" : `Fallback ${ordered.length}`
    const choice = unlessCancelled(await p.select<string>({
      message: position,
      options: remaining.map((model) => ({ value: model, label: model })),
      initialValue: remaining[0],
    }))
    if (choice === null) return null
    ordered.push(choice)
    remaining.splice(remaining.indexOf(choice), 1)
  }

  return [...ordered, ...remaining]
}

export async function promptConfirmWrite(summary: string): Promise<boolean | null> {
  p.note(summary, "Changes to save")
  return unlessCancelled(await p.confirm({ message: "Save these changes?", initialValue: true }))
}

export async function promptEnableRuntimeFallback(): Promise<boolean | null> {
  const value = await p.confirm({
    message: "Fallbacks currently only apply at startup. Also switch to the next model when one fails mid-session? (runtime_fallback)",
    initialValue: true,
  })
  return unlessCancelled(value)
}
