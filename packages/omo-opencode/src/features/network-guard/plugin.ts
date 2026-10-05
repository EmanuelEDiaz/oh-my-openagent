/** Real OpenCode wiring for the network guard (fork roadmap 0.15 A). */
import { networkInterfaces } from "node:os"

import type { OhMyOpenCodeConfig } from "../../config"
import { ResilienceConfigSchema } from "../../config/schema/resilience"
import { getFallbackModelsForSession } from "../../hooks/runtime-fallback/fallback-models"
import { dispatchInternalPrompt } from "../../hooks/shared/prompt-async-gate"
import { createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { parseModel, resolveSessionTarget } from "../../shared/session-target"
import type { PluginContext } from "../../plugin/types"
import { abortWithTimeout } from "../background-agent/abort-with-timeout"
import { registerManagerForCleanup } from "../background-agent/process-cleanup"
import { clearInterruption, recordInterruption } from "../interruption/store"
import { getActiveLoopBreaker } from "../loop-breaker/plugin"
import { createNetworkGuard, notifyNetworkGuardChange, setNetworkGuard, setNetworkResilienceEnabled, type NetworkGuard } from "./index"
import { watchLinkChanges } from "./link-monitor"

const PROBE_TIMEOUT_MS = 5_000

/** Any HTTP response (even 404/405) means the host is reachable; only a transport failure is "down". */
export async function probeUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return true
  } catch {
    return false
  }
}

type ProviderInfo = { id?: string; api?: string; options?: Record<string, unknown>; models?: Record<string, { api?: { url?: string } }> }

/**
 * The provider's base URL: user `options.baseURL`, else the models.dev API URL of the session's model, the provider or
 * any of its models.
 */
export function providerBaseUrl(provider: ProviderInfo | undefined, modelID?: string): string | undefined {
  if (!provider) return undefined
  const fromOptions = provider.options?.baseURL
  if (typeof fromOptions === "string" && fromOptions.length > 0) return fromOptions
  const fromModel = modelID ? provider.models?.[modelID]?.api?.url : undefined
  if (typeof fromModel === "string" && fromModel.length > 0) return fromModel
  if (typeof provider.api === "string" && provider.api.length > 0) return provider.api
  for (const model of Object.values(provider.models ?? {})) {
    if (typeof model?.api?.url === "string" && model.api.url.length > 0) return model.api.url
  }
  return undefined
}

/** Local addresses of the external interfaces, sorted: a different value means the network changed. */
export function networkFingerprint(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string {
  const addresses: string[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal) addresses.push(`${name}/${entry.address}`)
    }
  }
  return addresses.sort().join(",")
}

type ProvidersClient = {
  config?: { providers?: (input?: unknown) => Promise<{ data?: { providers?: ProviderInfo[] } }> }
  provider?: { list?: (input?: unknown) => Promise<{ data?: { all?: ProviderInfo[] } }> }
}

export function createPluginNetworkGuard(ctx: PluginContext, pluginConfig: OhMyOpenCodeConfig): NetworkGuard | null {
  // Set before anything that can throw, so a failed creation never leaves the fallback paths stepping aside.
  setNetworkResilienceEnabled(pluginConfig.resilience?.enabled !== false)
  const config = ResilienceConfigSchema.parse(pluginConfig.resilience ?? {})
  if (!config.enabled) return null

  const providerUrls = new Map<string, string | undefined>()
  const client = ctx.client as unknown as ProvidersClient

  async function lookupProviderUrl(providerID: string, modelID: string | undefined): Promise<string | undefined> {
    const key = `${providerID}/${modelID ?? ""}`
    if (providerUrls.has(key)) return providerUrls.get(key)
    let url: string | undefined
    try {
      const configured = await client.config?.providers?.({ query: { directory: ctx.directory } })
      url = providerBaseUrl(configured?.data?.providers?.find((provider) => provider.id === providerID), modelID)
      if (!url) {
        const listed = await client.provider?.list?.({ query: { directory: ctx.directory } })
        url = providerBaseUrl(listed?.data?.all?.find((provider) => provider.id === providerID), modelID)
      }
    } catch (error) {
      // OpenCode's server is local: if it fails, probe only the neutral site this time.
      log("[network-guard] provider lookup failed", { providerID, error: String(error) })
      return undefined
    }
    // Without a URL the guard still catches a failing provider: continuations that fail in a row hand off.
    providerUrls.set(key, url)
    return url
  }

  async function dispatch(sessionID: string, text: string, model?: string): Promise<void> {
    const target = await resolveSessionTarget(ctx.client as never, sessionID).catch(() => ({} as { agent?: string; model?: string }))
    // No model given: pin the one the session was using, so "same model" does not depend on the agent's default.
    const pinned = model ?? target.model
    const parsed = pinned ? parseModel(pinned) : undefined
    const result = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: "network-guard",
      queueBehavior: "defer",
      input: {
        path: { id: sessionID },
        body: {
          ...(target.agent ? { agent: target.agent } : {}),
          ...(parsed ? { model: { providerID: parsed.providerID, modelID: parsed.modelID } } : {}),
          ...(parsed?.variant ? { variant: parsed.variant } : {}),
          parts: [createInternalAgentContinuationTextPart(text)],
        },
        query: { directory: ctx.directory },
      },
    })
    log("[network-guard] continuation dispatched", { sessionID, status: result.status, ...(pinned ? { model: pinned } : {}) })
    // The work goes on by itself: the one-shot resume note for the user's next message is no longer needed.
    if (result.status === "dispatched" || result.status === "queued") clearInterruption(ctx.directory, sessionID)
  }

  const toast = async (message: string, variant: "info" | "success" | "warning" | "error"): Promise<void> => {
    await ctx.client.tui
      .showToast({ body: { title: "Red", message, variant, duration: variant === "error" ? 20_000 : 8_000 } })
      .catch(() => undefined)
  }

  const guard = createNetworkGuard(
    {
      probeLimit: config.network_probe_limit,
      backoffS: config.network_backoff_s,
      neutralProbeUrl: config.neutral_probe_url,
      silentStreamMs: config.silent_stream_s * 1000,
      checkIntervalMs: 15_000,
    },
    {
      probe: (url) => probeUrl(url),
      providerProbeUrl: async (sessionID) => {
        const target = await resolveSessionTarget(ctx.client as never, sessionID)
        const parsed = target.model ? parseModel(target.model) : undefined
        return parsed?.providerID ? lookupProviderUrl(parsed.providerID, parsed.modelID) : undefined
      },
      toast,
      // Same session, same agent, and the model the session was using.
      continueSession: (sessionID, text) => dispatch(sessionID, text),
      abort: async (sessionID) => {
        await abortWithTimeout(ctx.client as never, sessionID)
      },
      handOff: async (sessionID, detail) => {
        const target = await resolveSessionTarget(ctx.client as never, sessionID).catch(() => ({} as { agent?: string; model?: string }))
        const next = getFallbackModelsForSession(sessionID, target.agent, pluginConfig).find((model) => model !== target.model)
        if (!next) {
          recordInterruption(ctx.directory, { sessionID, cause: "network", detail, at: Date.now() })
          await toast("El proveedor no responde y no hay modelo de respaldo. El trabajo está guardado; escribe cualquier mensaje para continuar.", "error")
          return
        }
        await toast(`El proveedor no responde (la red funciona); continuando con ${next}.`, "warning")
        await dispatch(sessionID, `[network-guard] The provider of ${target.model ?? "the previous model"} is unreachable. Continue from the last completed step; check the effect of any tool call that was cut before repeating it.`, next)
      },
      recordInterruption: (sessionID, detail) => {
        recordInterruption(ctx.directory, { sessionID, cause: "network", detail, at: Date.now() })
      },
      watchLink: (onChange) => watchLinkChanges(onChange, log),
      networkFingerprint: () => networkFingerprint(),
      chargeBudget: (sessionID) => getActiveLoopBreaker()?.charge(sessionID, "provider failing while the network works"),
      log,
      onChange: notifyNetworkGuardChange,
    },
  )
  setNetworkGuard(guard)
  registerManagerForCleanup({ shutdown: async () => guard.dispose() })
  return guard
}
