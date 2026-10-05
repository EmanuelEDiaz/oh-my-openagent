export type Page<T> = { readonly items: T[]; readonly page: number; readonly totalPages: number }

export function paginate<T>(items: readonly T[], page: number, pageSize: number): Page<T> {
  if (pageSize <= 0) throw new RangeError("pageSize must be positive")
  const totalPages = Math.ceil(items.length / pageSize)
  const start = page * pageSize
  return { items: items.slice(start, start + pageSize), page, totalPages }
}
