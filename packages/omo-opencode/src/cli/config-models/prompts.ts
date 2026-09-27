import * as p from "@clack/prompts"

import type { ChainAvailability } from "./agent-chains"
import { getAgentProfile } from "./agent-profiles"
import { describeModelShort } from "./model-catalog"
import type { RankedModel } from "./model-ranking"

function unlessCancelled<TValue>(value: TValue): Exclude<TValue, symbol> | null {
  if (p.isCancel(value)) {
    p.cancel("Model configuration cancelled.")
    return null
  }
  return value as Exclude<TValue, symbol>
}

function describeChain(status: ChainAvailability): string {
  if (status.models.length === 0) return "default chain"
  const chain = status.models.map((model) => (status.missing.includes(model) ? `${model} (missing)` : model))
  return chain.join(" -> ")
}

export async function promptAgents(statuses: readonly ChainAvailability[]): Promise<string[] | null> {
  const value = await p.multiselect<string>({
    message: "Which agents do you want to configure?",
    options: statuses.map((status) => ({
      value: status.agent,
      label: status.missing.length > 0 ? `${status.agent} [!]` : status.agent,
      hint: describeChain(status),
    })),
    initialValues: statuses.filter((status) => status.missing.length > 0).map((status) => status.agent),
    required: true,
  })
  return unlessCancelled(value)
}

export function formatRankedLabel(ranked: RankedModel): string {
  const star = ranked.recommendedRank === undefined ? " " : "*"
  const warn = ranked.warnings.length > 0 && ranked.info !== undefined ? " !" : ""
  return `${String(ranked.score).padStart(3)}${star} ${ranked.model}  ${describeModelShort(ranked.info)}${warn}`
}

export function formatRankedHint(ranked: RankedModel): string {
  const parts = [
    ranked.info?.description,
    ranked.recommendedRank === undefined ? undefined : `omo pick #${ranked.recommendedRank + 1} for this agent`,
    ranked.info?.knowledge === undefined ? undefined : `knowledge ${ranked.info.knowledge}`,
    ...ranked.warnings,
  ]
  return parts.filter((part) => part !== undefined).join(" | ")
}

export function formatRankingTable(agent: string, ranked: readonly RankedModel[], top: number): string {
  const lines = [
    getAgentProfile(agent).role,
    "score = fit for this agent (0-100); * = recommended by oh-my-openagent; ! = warning",
    "",
    ...ranked.slice(0, top).map((entry, index) => {
      const line = `${String(index + 1).padStart(2)}. ${formatRankedLabel(entry)}`
      return entry.warnings.length > 0 ? `${line}\n      ${entry.warnings.join("; ")}` : line
    }),
  ]
  return lines.join("\n")
}

export async function promptModels(params: {
  readonly agent: string
  readonly ranked: readonly RankedModel[]
  readonly current: readonly string[]
}): Promise<string[] | null> {
  p.note(formatRankingTable(params.agent, params.ranked, 10), `Top models for ${params.agent}`)
  const available = new Set(params.ranked.map((entry) => entry.model))
  const value = await p.autocompleteMultiselect<string>({
    message: `Models for ${params.agent} (type to filter: name, "img", "free", "1M"...; Tab to toggle, Enter to confirm)`,
    options: params.ranked.map((entry) => ({
      value: entry.model,
      label: formatRankedLabel(entry),
      hint: formatRankedHint(entry),
    })),
    initialValues: params.current.filter((model) => available.has(model)),
    placeholder: "e.g. claude, gpt, free, img",
    maxItems: 12,
    required: true,
  })
  return unlessCancelled(value)
}

/** Clack multiselect returns options in list order, so the chain order is asked explicitly. */
export async function promptOrder(params: {
  readonly agent: string
  readonly selected: readonly string[]
  readonly preferred: readonly string[]
  readonly labels?: ReadonlyMap<string, string>
}): Promise<string[] | null> {
  const rank = (model: string): number => {
    const index = params.preferred.indexOf(model)
    return index === -1 ? Number.MAX_SAFE_INTEGER : index
  }
  const remaining = [...params.selected].sort((left, right) => rank(left) - rank(right))
  const ordered: string[] = []

  while (remaining.length > 1) {
    const position = ordered.length === 0 ? "primary model" : `fallback #${ordered.length}`
    const choice = unlessCancelled(await p.select<string>({
      message: `${params.agent}: choose the ${position}`,
      options: remaining.map((model) => ({ value: model, label: params.labels?.get(model) ?? model })),
      initialValue: remaining[0],
    }))
    if (choice === null) return null
    ordered.push(choice)
    remaining.splice(remaining.indexOf(choice), 1)
  }

  return [...ordered, ...remaining]
}

export async function promptEnableRuntimeFallback(): Promise<boolean | null> {
  const value = await p.confirm({
    message: "runtime_fallback is disabled. Enable it so the next model is used when one fails mid-session?",
    initialValue: true,
  })
  return unlessCancelled(value)
}
