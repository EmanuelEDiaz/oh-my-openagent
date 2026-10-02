type ProviderEntry = { options?: Record<string, unknown> } & Record<string, unknown>

/**
 * OpenCode 1.18.26 waits forever on a stream that stops sending chunks. A `chunkTimeout` makes it fail as a retryable
 * error, which OpenCode retries and the plugin's fallbacks can act on (fork roadmap 0.8a). Applied to the always-present
 * `opencode` provider and the connected ones; a value the user set (even `false`) is never changed.
 */
export function applyChunkTimeoutDefaults(
  config: Record<string, unknown>,
  connectedProviders: readonly string[],
  timeoutMs: number | false,
): void {
  if (timeoutMs === false) return
  const providers = (config.provider ??= {}) as Record<string, ProviderEntry>
  for (const providerID of new Set([...connectedProviders, "opencode"])) {
    const entry = (providers[providerID] ??= {})
    const options = (entry.options ??= {})
    if (!("chunkTimeout" in options)) options.chunkTimeout = timeoutMs
  }
}
