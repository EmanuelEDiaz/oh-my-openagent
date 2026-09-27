import { formatCost, formatTokens } from "./model-catalog"
import type { ModelInfo } from "./model-catalog"
import type { RankedModel } from "./model-ranking"

const MODALITY_NAMES: Readonly<Record<string, string>> = {
  image: "images",
  pdf: "PDF",
  video: "video",
  audio: "audio",
}

export function formatInputs(info: ModelInfo | undefined): string {
  if (info === undefined) return "?"
  const extra = info.inputModalities.filter((modality) => modality !== "text").map((modality) => MODALITY_NAMES[modality] ?? modality)
  return extra.length === 0 ? "text only" : `text, ${extra.join(", ")}`
}

function formatPrice(info: ModelInfo | undefined): string {
  if (info === undefined) return "?"
  const cost = formatCost(info)
  return cost.endsWith(" per 1M") ? cost.replace(" per 1M", "") : cost
}

/** Short, human sentence shown only for the focused option. */
export function formatFocusHint(ranked: RankedModel): string {
  const { info } = ranked
  if (info === undefined) return "no details available for this model"
  const parts = [
    `${formatTokens(info.contextTokens)} context`,
    formatInputs(info),
    info.reasoning ? "thinks step by step" : undefined,
    formatPrice(info),
    ranked.recommendedRank === undefined ? undefined : "recommended by omo",
    ...ranked.warnings.map((warning) => `WARNING: ${warning}`),
  ]
  return parts.filter((part) => part !== undefined).join(" · ")
}

export function formatOptionLabel(ranked: RankedModel): string {
  const mark = ranked.warnings.length > 0 && ranked.info !== undefined ? "  (!)" : ranked.recommendedRank === undefined ? "" : "  *"
  return `${ranked.model}${mark}`
}

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + "~" : value.padEnd(width)
}

/** Aligned table: one idea per column instead of one long dotted line. */
export function formatRankingTable(ranked: readonly RankedModel[], top: number): string {
  const rows = ranked.slice(0, top)
  const modelWidth = Math.min(48, Math.max(5, ...rows.map((entry) => entry.model.length)) + 2)
  const header = `${pad("#", 4)}${pad("Score", 7)}${pad("Model", modelWidth)}${pad("Context", 9)}${pad("Input", 30)}Price ($/1M in/out)`
  const lines = rows.map((entry, index) => [
    pad(String(index + 1), 4),
    pad(`${entry.score}${entry.recommendedRank === undefined ? "" : "*"}`, 7),
    pad(entry.model, modelWidth),
    pad(formatTokens(entry.info?.contextTokens), 9),
    pad(formatInputs(entry.info), 30),
    formatPrice(entry.info),
  ].join(""))
  return [header, ...lines].join("\n")
}

export function formatChain(models: readonly string[]): string {
  return models.map((model, index) => `${index === 0 ? "primary   " : `fallback ${index}`}  ${model}`).join("\n")
}
