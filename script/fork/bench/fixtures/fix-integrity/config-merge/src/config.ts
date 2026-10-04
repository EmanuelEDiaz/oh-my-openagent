export type RetryOptions = { attempts: number; delayMs: number }
export type ClientConfig = { baseUrl: string; timeoutMs: number; retry: RetryOptions }
export type ClientOptions = Partial<Omit<ClientConfig, "retry">> & { retry?: Partial<RetryOptions> }

export const DEFAULTS: ClientConfig = {
  baseUrl: "http://localhost:8080",
  timeoutMs: 5000,
  retry: { attempts: 3, delayMs: 100 },
}

export function withDefaults(options: ClientOptions = {}): ClientConfig {
  return { ...DEFAULTS, ...options } as ClientConfig
}
