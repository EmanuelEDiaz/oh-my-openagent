export type FetchLike = (url: string) => Promise<Response>

/** `/api/<resource>` or `/api/<resource>/<id>`. */
export function apiUrl(resource: string, id?: string): string {
  return id === undefined ? `/api/${resource}` : `/api/${resource}/${encodeURIComponent(id)}`
}

export async function getJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchImpl(url)
  if (!response.ok) throw new Error(`GET ${url} failed with ${response.status}`)
  return (await response.json()) as T
}
