import { getAgentProfile } from "../../cli/config-models/agent-profiles"
import type { ModelInfo } from "../../cli/config-models/model-catalog"
import { matchKey } from "./external-data"
import type { BenchmarkFacts, ExternalData, ReliabilityFacts } from "./external-data"
import { freeModelNotes } from "./free-model-notes"
import type { FreeModelNote } from "./free-model-notes"
import { isFreeModel } from "./model-options"
import type { ProviderModelView } from "./model-options"

/** Everything known about one model, each group tied to the source it came from. */
export type ModelFacts = {
  readonly id: string
  readonly provider: string
  readonly model: ProviderModelView
  readonly catalog: ModelInfo | undefined
  readonly description: string | undefined
  readonly descriptionSource: string | undefined
  readonly benchmarks: BenchmarkFacts | undefined
  readonly reliability: ReliabilityFacts | undefined
  readonly notes: readonly FreeModelNote[]
}

export type DetailRow = { readonly category: string; readonly title: string; readonly footer?: string }

export function collectFacts(params: {
  readonly provider: string
  readonly model: ProviderModelView
  readonly catalog: ReadonlyMap<string, ModelInfo>
  readonly external: ExternalData | undefined
  readonly reliability?: ReliabilityFacts | undefined
}): ModelFacts {
  const id = `${params.provider}/${params.model.id}`
  const catalog = params.catalog.get(id)
  const openRouter = params.provider === "openrouter" ? params.external?.openRouter[params.model.id] : undefined
  const description = catalog?.description ?? openRouter?.description
  return {
    id,
    provider: params.provider,
    model: params.model,
    catalog,
    description,
    descriptionSource: catalog?.description !== undefined ? "models.dev" : openRouter?.description !== undefined ? "OpenRouter" : undefined,
    benchmarks: params.external?.benchmarks[matchKey(params.model.id)],
    reliability: params.reliability,
    notes: freeModelNotes(id),
  }
}

function tokens(value: number | undefined): string | undefined {
  if (value === undefined || value <= 0) return undefined
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  return `${Math.round(value / 1000)}k`
}

function inputs(model: ProviderModelView): string[] {
  const input = model.capabilities?.input ?? {}
  return (["image", "pdf", "audio", "video"] as const).filter((kind) => input[kind] === true)
}

/** One short line for the list: the things people scan first when picking a coding model. */
export function previewLine(facts: ModelFacts): string {
  const { model } = facts
  const parts = [
    tokens(model.limit?.context) === undefined ? undefined : `${tokens(model.limit?.context)} ctx`,
    model.capabilities?.toolcall === false ? "NO tools" : undefined,
    model.capabilities?.reasoning ? "thinks" : undefined,
    inputs(model).includes("image") ? "img" : undefined,
    facts.benchmarks?.codingIndex === undefined ? undefined : `code ${Math.round(facts.benchmarks.codingIndex)}`,
  ]
  return parts.filter((part) => part !== undefined).join(" · ")
}

function price(value: number | undefined): string {
  if (value === undefined) return "?"
  return value === 0 ? "free" : `$${value}`
}

function agentFitRows(agent: string, facts: ModelFacts): DetailRow[] {
  const profile = getAgentProfile(agent)
  const category = `Fit for ${agent}`
  const rows: DetailRow[] = [{ category, title: profile.role }]
  const { model } = facts
  if (model.capabilities?.toolcall === false) rows.push({ category, title: "⚠ No tool calling: the agent could not read or edit files" })
  if (profile.needsImageInput && !inputs(model).includes("image")) rows.push({ category, title: "⚠ No image input: this agent needs to see images" })
  const context = model.limit?.context
  if (context !== undefined && context > 0 && context < 64_000) rows.push({ category, title: `⚠ Small context (${tokens(context)}): frequent compaction` })
  if (model.status === "deprecated") rows.push({ category, title: "⚠ Marked deprecated by the provider" })
  if (rows.length === 1) rows.push({ category, title: "✓ No blocking issues for this agent" })
  return rows
}

/** Detailed, source-attributed facts for the "are you sure?" screen. */
export function detailRows(agent: string, facts: ModelFacts): DetailRow[] {
  const { model, catalog, benchmarks, reliability } = facts
  const rows: DetailRow[] = [...agentFitRows(agent, facts)]

  const about = "What it is"
  rows.push({ category: about, title: facts.description ?? "No description published", footer: facts.descriptionSource ?? "" })
  if (model.family) rows.push({ category: about, title: `Family: ${model.family}` })
  if (model.release_date) rows.push({ category: about, title: `Released: ${model.release_date}` })
  if (catalog?.knowledge) rows.push({ category: about, title: `Knowledge cutoff: ${catalog.knowledge}`, footer: "models.dev" })
  if (catalog?.openWeights) rows.push({ category: about, title: "Open weights (can also be self-hosted)", footer: "models.dev" })
  if (model.status && model.status !== "active") rows.push({ category: about, title: `Status: ${model.status}` })

  const limits = "Limits"
  rows.push({ category: limits, title: `Context window: ${tokens(model.limit?.context) ?? "unknown"} tokens` })
  rows.push({ category: limits, title: `Max output: ${tokens(model.limit?.output) ?? "unknown"} tokens` })

  const cost = "Price per 1M tokens"
  if (isFreeModel(model)) rows.push({ category: cost, title: "Free" })
  else {
    rows.push({ category: cost, title: `Input ${price(model.cost?.input)} · Output ${price(model.cost?.output)}` })
    if (model.cost?.cache?.read !== undefined && model.cost.cache.read > 0) rows.push({ category: cost, title: `Cached input ${price(model.cost.cache.read)} (cheaper repeated context)` })
  }

  const abilities = "Capabilities"
  rows.push({ category: abilities, title: `Tool calling: ${model.capabilities?.toolcall === false ? "no" : "yes"}` })
  rows.push({ category: abilities, title: `Reasoning / thinking: ${model.capabilities?.reasoning ? "yes" : "no"}` })
  rows.push({ category: abilities, title: `Reads: text${inputs(model).length > 0 ? `, ${inputs(model).join(", ")}` : ""}` })

  const bench = "Benchmarks · Artificial Analysis"
  if (benchmarks === undefined) {
    rows.push({ category: bench, title: "No exact match. Set ARTIFICIAL_ANALYSIS_API_KEY (free key) for independent scores and speed." })
  } else {
    const index = (label: string, value: number | undefined): void => {
      if (value !== undefined) rows.push({ category: bench, title: `${label}: ${Number(value.toFixed(1))} / 100`, footer: benchmarks.name })
    }
    index("Coding index", benchmarks.codingIndex)
    index("Agentic index", benchmarks.agenticIndex)
    index("Intelligence index", benchmarks.intelligenceIndex)
    if (benchmarks.outputTokensPerSecond !== undefined) rows.push({ category: bench, title: `Speed: ${Math.round(benchmarks.outputTokensPerSecond)} tokens/s (median)` })
    if (benchmarks.timeToFirstTokenSeconds !== undefined) rows.push({ category: bench, title: `Time to first token: ${Number(benchmarks.timeToFirstTokenSeconds.toFixed(2))} s (median)` })
  }

  if (reliability !== undefined) {
    const reliable = "Reliability · OpenRouter"
    rows.push({ category: reliable, title: `${reliability.providers} provider(s) serve it` })
    if (reliability.bestUptimeLastDay !== undefined) rows.push({ category: reliable, title: `Best uptime, last 24h: ${Number(reliability.bestUptimeLastDay.toFixed(2))}%` })
  }

  for (const note of facts.notes) {
    rows.push({ category: "Free tier", title: note.text, footer: `checked ${note.checkedAt}` })
  }
  const sources = new Set(["OpenCode (limits, price, capabilities)"])
  if (facts.descriptionSource) sources.add(facts.descriptionSource)
  if (benchmarks) sources.add("artificialanalysis.ai")
  if (reliability) sources.add("openrouter.ai")
  for (const note of facts.notes) sources.add(note.source)
  rows.push({ category: "Sources", title: [...sources].join(" · ") })
  return rows
}

/** The TUI dialog clips long rows, so long facts are split into word-wrapped lines. */
export function wrapText(text: string, width = 50): string[] {
  const lines: string[] = []
  let line = ""
  for (const word of text.split(/\s+/)) {
    if (line.length > 0 && line.length + 1 + word.length > width) {
      lines.push(line)
      line = `  ${word}`
    } else {
      line = line.length === 0 ? word : `${line} ${word}`
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}
