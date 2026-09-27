import * as p from "@clack/prompts"

import type { ChainAvailability } from "./agent-chains"

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

export async function promptModels(params: {
  readonly agent: string
  readonly available: readonly string[]
  readonly current: readonly string[]
}): Promise<string[] | null> {
  const value = await p.autocompleteMultiselect<string>({
    message: `Models for ${params.agent} (type to filter, Tab to toggle, Enter to confirm)`,
    options: params.available.map((model) => ({ value: model, label: model })),
    initialValues: params.current.filter((model) => params.available.includes(model)),
    placeholder: "e.g. claude, gpt, free",
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
      options: remaining.map((model) => ({ value: model, label: model })),
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
