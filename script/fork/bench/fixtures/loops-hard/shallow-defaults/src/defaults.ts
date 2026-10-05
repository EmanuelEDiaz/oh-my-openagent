export type Filter = { readonly field: string; readonly value: string }
export type Query = { limit: number; filters: Filter[]; sort: { field: string; dir: "asc" | "desc" } }

export const DEFAULT_QUERY: Query = { limit: 20, filters: [], sort: { field: "createdAt", dir: "desc" } }
