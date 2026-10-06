type ProviderEntry = { options?: Record<string, unknown> } & Record<string, unknown>

/** Providers whose OpenCode loader already sets its own `headerTimeout` (1.18.26: openai, 300 s): left to OpenCode. */
const BUILTIN_HEADER_TIMEOUT_PROVIDERS: ReadonlySet<string> = new Set(["openai"])

/**
 * OpenCode 1.18.26 waits forever on a stream that stops sending chunks. A `chunkTimeout` makes it fail as a retryable
 * error, which OpenCode retries and the plugin's fallbacks can act on (fork roadmap 0.8a). `chunkTimeout` only covers
 * gaps in a body that already started; the wait for the response headers is `headerTimeout` (a retryable
 * `ProviderHeaderTimeoutError`), which OpenCode only defaults for openai. Both are provider `options` read by the
 * AI SDK fetch wrapper of every provider. Applied to the always-present `opencode` provider and the connected ones;
 * a value the user set (even `false`) is never changed.
 */
export function applyChunkTimeoutDefaults(
  config: Record<string, unknown>,
  connectedProviders: readonly string[],
  timeoutMs: number | false,
  headerTimeoutMs: number | false = false,
): void {
  if (timeoutMs === false && headerTimeoutMs === false) return
  const providers = (config.provider ??= {}) as Record<string, ProviderEntry>
  for (const providerID of new Set([...connectedProviders, "opencode"])) {
    const entry = (providers[providerID] ??= {})
    const options = (entry.options ??= {})
    if (timeoutMs !== false && !("chunkTimeout" in options)) options.chunkTimeout = timeoutMs
    if (headerTimeoutMs !== false && !("headerTimeout" in options) && !BUILTIN_HEADER_TIMEOUT_PROVIDERS.has(providerID)) {
      options.headerTimeout = headerTimeoutMs
    }
  }
}
