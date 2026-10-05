import type { Query } from "./defaults"

export function scopeToTenant(query: Query, tenant: string): Query {
  query.filters.push({ field: "tenant", value: tenant })
  return query
}
