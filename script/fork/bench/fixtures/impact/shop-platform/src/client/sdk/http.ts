import { API_BASE } from "./config"

export type FetchLike = (url: string) => Promise<Response>

export function apiPath(segments: readonly string[], id?: string): string {
  const parts = id === undefined ? segments : [...segments, encodeURIComponent(id)]
  return [API_BASE, ...parts].join("/")
}

export async function getJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return (await response.json()) as T
}
