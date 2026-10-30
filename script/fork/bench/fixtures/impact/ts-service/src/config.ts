export type Config = { readonly upstreamUrl: string; readonly token: string; readonly port: number }

export function loadConfig(): Config {
  const token = process.env.API_TOKEN ?? ""
  const port = Number(process.env.PORT ?? 3000)
  return { upstreamUrl: process.env.UPSTREAM_URL ?? "http://localhost:4000", token, port }
}
