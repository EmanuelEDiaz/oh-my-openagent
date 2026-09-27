import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { resolveUserOmoConfigPath, updateOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { OmoConfigEdit } from "@oh-my-opencode/omo-config-core"

import { parseJsonc } from "../../shared"
import {
  buildChainEntries,
  checkChainAvailability,
  readAgentChain,
  readAgentChains,
} from "./agent-chains"
import type { ChainAvailability, ModelChainEntry } from "./agent-chains"
import { listAvailableModels } from "./available-models"
import type { AvailableModels } from "./available-models"
import * as defaultPrompts from "./prompts"

export type ConfigModelsScope = "user" | "project"

export type ConfigModelsPrompts = {
  readonly promptAgents: typeof defaultPrompts.promptAgents
  readonly promptModels: typeof defaultPrompts.promptModels
  readonly promptOrder: typeof defaultPrompts.promptOrder
  readonly promptEnableRuntimeFallback: typeof defaultPrompts.promptEnableRuntimeFallback
}

export type ConfigModelsOptions = {
  readonly check?: boolean
  readonly agent?: string
  readonly models?: readonly string[]
  readonly allowUnavailable?: boolean
  readonly enableRuntimeFallback?: boolean
  readonly scope?: ConfigModelsScope
  readonly cwd?: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly json?: boolean
  readonly output?: (line: string) => void
  readonly isInteractive?: () => boolean
  readonly listModels?: () => AvailableModels
  readonly prompts?: ConfigModelsPrompts
}

type OpenCodeSection = {
  readonly agents: Readonly<Record<string, unknown>>
  readonly runtimeFallback: unknown
}

type ModelsContext = {
  readonly options: ConfigModelsOptions
  readonly output: (line: string) => void
  readonly configPath: string
  readonly section: OpenCodeSection
  readonly available: AvailableModels
  readonly availableSet: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function resolveConfigPath(scope: ConfigModelsScope, cwd: string, env: ConfigModelsOptions["env"]): string {
  const jsoncPath = scope === "user"
    ? resolveUserOmoConfigPath(env ?? process.env)
    : join(cwd, ".omo", "omo.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath
  const jsonPath = join(dirname(jsoncPath), "omo.json")
  return existsSync(jsonPath) ? jsonPath : jsoncPath
}

function readOpenCodeSection(path: string): OpenCodeSection {
  if (!existsSync(path)) return { agents: {}, runtimeFallback: undefined }
  const document = parseJsonc<Record<string, unknown>>(readFileSync(path, "utf-8"))
  const section = isRecord(document?.["[opencode]"]) ? document["[opencode]"] : {}
  return {
    agents: isRecord(section["agents"]) ? section["agents"] : {},
    runtimeFallback: section["runtime_fallback"],
  }
}

function isRuntimeFallbackEnabled(value: unknown): boolean {
  if (value === true) return true
  return isRecord(value) && value["enabled"] !== false
}

function describeSource(available: AvailableModels): string {
  if (available.source === "opencode-cli") return "`opencode models` (providers connected right now)"
  if (available.source === "models-cache") return "models.dev cache (connection status unknown; run `opencode models --refresh`)"
  return "no source"
}

function statusesFor(context: ModelsContext): ChainAvailability[] {
  return readAgentChains(context.section.agents).map((chain) => checkChainAvailability(chain, context.availableSet))
}

function printStatuses(context: ModelsContext, statuses: readonly ChainAvailability[]): void {
  const { output } = context
  output(`config: ${context.configPath}`)
  output(`available models: ${context.available.models.length} from ${describeSource(context.available)}`)
  output(`runtime_fallback: ${isRuntimeFallbackEnabled(context.section.runtimeFallback) ? "enabled" : "disabled"}`)
  for (const status of statuses) {
    if (status.models.length === 0) {
      output(`  ${status.agent}: (built-in default chain)`)
      continue
    }
    const marker = status.firstAvailable === undefined ? "BROKEN" : status.missing.length > 0 ? "WARN" : "ok"
    const chain = status.models.map((model) => (status.missing.includes(model) ? `${model} (missing)` : model))
    output(`  [${marker}] ${status.agent}: ${chain.join(" -> ")}`)
  }
}

function chainEdits(agent: string, entries: readonly ModelChainEntry[]): OmoConfigEdit[] {
  const agentPath = ["[opencode]", "agents", agent]
  return [
    { path: [...agentPath, "models"], value: entries },
    { path: [...agentPath, "model"], value: undefined },
    { path: [...agentPath, "fallback_models"], value: undefined },
  ]
}

function writeEdits(context: ModelsContext, edits: readonly OmoConfigEdit[]): void {
  const scope = context.options.scope ?? "user"
  const result = updateOmoConfig({
    edits,
    scope,
    ...(scope === "project" ? { projectDir: context.options.cwd ?? process.cwd() } : {}),
    ...(context.options.env === undefined ? {} : { env: context.options.env }),
  })
  context.output(`wrote ${result.path}${result.backupPath === undefined ? "" : ` (backup: ${result.backupPath})`}`)
}

function runtimeFallbackEdit(): OmoConfigEdit {
  return { path: ["[opencode]", "runtime_fallback"], value: true }
}

function runCheck(context: ModelsContext): number {
  const statuses = statusesFor(context)
  if (context.options.json) {
    context.output(JSON.stringify({
      configPath: context.configPath,
      source: context.available.source,
      availableCount: context.available.models.length,
      runtimeFallback: isRuntimeFallbackEnabled(context.section.runtimeFallback),
      agents: statuses,
    }, null, 2))
  } else {
    printStatuses(context, statuses)
  }
  return statuses.some((status) => status.models.length > 0 && status.firstAvailable === undefined) ? 1 : 0
}

function runSet(context: ModelsContext, agent: string, models: readonly string[]): number {
  const unknown = models.filter((model) => !context.availableSet.has(model))
  if (unknown.length > 0 && !context.options.allowUnavailable) {
    context.output(`error: not available right now: ${unknown.join(", ")} (use --allow-unavailable to write anyway)`)
    return 1
  }
  const entries = buildChainEntries(models, readAgentChain(context.section.agents[agent]))
  const edits = chainEdits(agent, entries)
  if (context.options.enableRuntimeFallback && !isRuntimeFallbackEnabled(context.section.runtimeFallback)) {
    edits.push(runtimeFallbackEdit())
  }
  writeEdits(context, edits)
  context.output(`${agent}: ${models.join(" -> ")}`)
  return 0
}

async function runInteractive(context: ModelsContext, prompts: ConfigModelsPrompts): Promise<number> {
  const statuses = statusesFor(context)
  printStatuses(context, statuses)

  const agents = await prompts.promptAgents(statuses)
  if (agents === null) return 1

  const edits: OmoConfigEdit[] = []
  for (const agent of agents) {
    const previous = readAgentChain(context.section.agents[agent])
    const current = previous.map((entry) => (typeof entry === "string" ? entry : entry.model))
    const selected = await prompts.promptModels({ agent, available: context.available.models, current })
    if (selected === null) return 1
    const ordered = await prompts.promptOrder({ agent, selected, preferred: current })
    if (ordered === null) return 1
    edits.push(...chainEdits(agent, buildChainEntries(ordered, previous)))
    context.output(`${agent}: ${ordered.join(" -> ")}`)
  }

  if (!isRuntimeFallbackEnabled(context.section.runtimeFallback)) {
    const enable = context.options.enableRuntimeFallback ?? await prompts.promptEnableRuntimeFallback()
    if (enable === null) return 1
    if (enable) edits.push(runtimeFallbackEdit())
  }

  if (edits.length > 0) writeEdits(context, edits)
  return 0
}

export async function runConfigModels(options: ConfigModelsOptions = {}): Promise<number> {
  const output = options.output ?? console.log
  const cwd = options.cwd ?? process.cwd()
  const configPath = resolveConfigPath(options.scope ?? "user", cwd, options.env)

  let section: OpenCodeSection
  try {
    section = readOpenCodeSection(configPath)
  } catch (error) {
    output(`error: cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }

  const available = (options.listModels ?? listAvailableModels)()
  const context: ModelsContext = {
    options,
    output,
    configPath,
    section,
    available,
    availableSet: new Set(available.models),
  }

  if (options.check) return runCheck(context)

  if (available.models.length === 0) {
    output("error: no models found. Run `opencode models --refresh` or connect a provider with `opencode auth login`.")
    return 1
  }

  if (options.agent !== undefined || options.models !== undefined) {
    if (options.agent === undefined || options.models === undefined || options.models.length === 0) {
      output("error: --agent and --models must be used together")
      return 1
    }
    return runSet(context, options.agent, options.models)
  }

  const isInteractive = options.isInteractive ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY))
  if (!isInteractive()) {
    output("error: interactive mode needs a TTY. Use --check, or --agent <name> --models <a,b,c>.")
    return 1
  }
  return runInteractive(context, options.prompts ?? defaultPrompts)
}
