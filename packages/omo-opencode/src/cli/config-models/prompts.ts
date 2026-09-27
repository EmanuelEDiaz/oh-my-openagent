import * as p from "@clack/prompts"

import type { ChainAvailability } from "./agent-chains"
import { getAgentProfile } from "./agent-profiles"
import { formatChain, formatFocusHint, formatOptionLabel, formatRankingTable } from "./format"
import { suggestChain } from "./model-ranking"
import type { RankedModel } from "./model-ranking"

export type PickMode = "recommended" | "guided"

export type MenuAction = "fix-broken" | "one" | "all" | "save" | "exit"

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

export async function promptMainMenu(params: {
  readonly statuses: readonly ChainAvailability[]
  readonly pending: ReadonlyMap<string, readonly string[]>
}): Promise<MenuAction | null> {
  const needsFix = params.statuses.filter((status) => status.missing.length > 0 && !params.pending.has(status.agent))
  const pendingHint = params.pending.size === 0 ? "nothing changed yet" : [...params.pending.keys()].join(", ")
  const options: { value: MenuAction; label: string; hint?: string }[] = [
    ...(needsFix.length > 0
      ? [{ value: "fix-broken" as const, label: `Fix ${needsFix.length} agent(s) with missing models`, hint: "suggested chains, you review before saving" }]
      : []),
    { value: "one", label: "Configure one agent..." },
    { value: "all", label: "Configure all agents, one after another" },
    { value: "save", label: `Save and exit (${params.pending.size} change(s))`, hint: pendingHint },
    { value: "exit", label: "Exit without saving" },
  ]
  const value = await p.select<MenuAction>({
    message: "What do you want to do?",
    options,
    initialValue: needsFix.length > 0 ? "fix-broken" : params.pending.size > 0 ? "save" : "one",
  })
  return unlessCancelled(value)
}

export async function promptAgent(params: {
  readonly statuses: readonly ChainAvailability[]
  readonly pending: ReadonlyMap<string, readonly string[]>
}): Promise<string | null> {
  const value = await p.select<string>({
    message: "Which agent?",
    options: params.statuses.map((status) => ({
      value: status.agent,
      label: `${status.agent.padEnd(18)} ${getAgentProfile(status.agent).summary}`,
      hint: params.pending.has(status.agent) ? "changed (not saved yet)" : statusWord(status),
    })),
  })
  return unlessCancelled(value)
}

export async function promptMode(agent: string): Promise<PickMode | null> {
  const value = await p.select<PickMode>({
    message: `How do you want to choose the models for ${agent}?`,
    options: [
      { value: "recommended", label: "Use a suggested chain", hint: "best 3 models, you accept or edit" },
      { value: "guided", label: "Pick them myself", hint: "primary first, then each fallback; search available" },
    ],
    initialValue: "recommended",
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
  return guidedChain(params.ranked)
}

export function showSuggestedFixes(summary: string): void {
  p.note(summary, "Suggested chains")
}

export async function promptAcceptFixes(): Promise<boolean | null> {
  return unlessCancelled(await p.confirm({ message: "Use these chains? (you can still change single agents before saving)", initialValue: true }))
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
