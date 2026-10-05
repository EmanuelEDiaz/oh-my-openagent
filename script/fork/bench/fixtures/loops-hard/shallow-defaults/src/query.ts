import { DEFAULT_QUERY, type Query } from "./defaults"
import { scopeToTenant } from "./tenant"

export type Options = { readonly limit?: number; readonly status?: string; readonly tenant?: string; readonly oldestFirst?: boolean }

export function buildQuery(options: Options = {}): Query {
  const query: Query = { ...DEFAULT_QUERY }
  if (options.limit !== undefined) query.limit = options.limit
  if (options.status) query.filters = [...query.filters, { field: "status", value: options.status }]
  if (options.tenant) scopeToTenant(query, options.tenant)
  if (options.oldestFirst) query.sort.dir = "asc"
  return query
}
