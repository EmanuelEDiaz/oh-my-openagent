export type Fetcher<T> = (id: string) => Promise<T>

export async function loadAll<T>(ids: readonly string[], fetchOne: Fetcher<T>): Promise<T[]> {
  const results: T[] = []
  ids.forEach(async (id) => {
    try {
      results.push(await fetchOne(id))
    } catch (error) {
      console.warn(`failed to load ${id}`, error)
    }
  })
  return results
}
