export type ProviderModelView = {
  readonly id: string
  readonly name?: string
  readonly family?: string
  readonly cost?: {
    readonly input?: number
    readonly output?: number
    readonly cache?: { readonly read?: number; readonly write?: number }
  }
  readonly limit?: { readonly context?: number; readonly output?: number }
  readonly capabilities?: {
    readonly reasoning?: boolean
    readonly toolcall?: boolean
    readonly attachment?: boolean
    readonly input?: Readonly<Partial<Record<"text" | "audio" | "image" | "video" | "pdf", boolean>>>
  }
  readonly status?: string
  readonly release_date?: string
}

export type ProviderView = {
  readonly id: string
  readonly name?: string
  readonly models: Readonly<Record<string, ProviderModelView>>
}

export type ModelOption = {
  readonly title: string
  readonly value: string
  readonly description: string
  readonly footer: string
  readonly category: string
}

export const ZEN_PROVIDER = "opencode"
export const ZEN_FREE_CATEGORY = "OpenCode Zen · Free"
export const ZEN_CATEGORY = "OpenCode Zen"

const FREE_SUFFIX_PATTERN = /(?:-free|:free)$/

export function isFreeModel(model: ProviderModelView): boolean {
  if (FREE_SUFFIX_PATTERN.test(model.id)) return true
  return model.cost?.input === 0 && (model.cost.output ?? 0) === 0
}

function formatContext(tokens: number | undefined): string | undefined {
  if (tokens === undefined || tokens <= 0) return undefined
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M ctx`
  return `${Math.round(tokens / 1000)}k ctx`
}

function formatFooter(model: ProviderModelView): string {
  if (isFreeModel(model)) return "Free"
  const input = model.cost?.input
  const output = model.cost?.output
  if (input === undefined) return ""
  return `$${input}/$${output ?? "?"}`
}

function categoryFor(provider: ProviderView, model: ProviderModelView): string {
  if (provider.id !== ZEN_PROVIDER) return provider.name ?? provider.id
  return isFreeModel(model) ? ZEN_FREE_CATEGORY : ZEN_CATEGORY
}

function categoryRank(category: string): number {
  if (category === ZEN_FREE_CATEGORY) return 0
  if (category === ZEN_CATEGORY) return 1
  return 2
}

/**
 * Every model OpenCode can use right now, grouped so OpenCode Zen free models come first, then the
 * rest of Zen, then each other provider. Search in the dialog matches the title (model name/id).
 */
export function buildModelOptions(
  providers: readonly ProviderView[],
  options: {
    readonly disabledProviders?: readonly string[]
    readonly exclude?: readonly string[]
    readonly describe?: (provider: string, model: ProviderModelView) => string
  } = {},
): ModelOption[] {
  const disabled = new Set(options.disabledProviders ?? [])
  const exclude = new Set(options.exclude ?? [])
  const result: ModelOption[] = []
  for (const provider of providers) {
    if (disabled.has(provider.id)) continue
    for (const [key, model] of Object.entries(provider.models)) {
      const id = `${provider.id}/${model.id || key}`
      if (exclude.has(id)) continue
      result.push({
        title: model.id || key,
        value: id,
        description: options.describe?.(provider.id, model) ?? formatContext(model.limit?.context) ?? "",
        footer: formatFooter(model),
        category: categoryFor(provider, model),
      })
    }
  }
  return result.sort((left, right) =>
    categoryRank(left.category) - categoryRank(right.category)
    || left.category.localeCompare(right.category)
    || left.title.localeCompare(right.title))
}
