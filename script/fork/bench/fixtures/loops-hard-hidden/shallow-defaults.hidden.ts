import { expect, test } from "bun:test"

import { DEFAULT_QUERY } from "../src/defaults"
import { buildQuery } from "../src/query"

test("hidden: calls never leak into each other or into the defaults", () => {
  const a = buildQuery({ tenant: "a", status: "open", oldestFirst: true, limit: 5 })
  const b = buildQuery({ tenant: "b" })
  expect(a).toEqual({ limit: 5, filters: [{ field: "status", value: "open" }, { field: "tenant", value: "a" }], sort: { field: "createdAt", dir: "asc" } })
  expect(b).toEqual({ limit: 20, filters: [{ field: "tenant", value: "b" }], sort: { field: "createdAt", dir: "desc" } })
  expect(DEFAULT_QUERY).toEqual({ limit: 20, filters: [], sort: { field: "createdAt", dir: "desc" } })
  expect(buildQuery()).toEqual({ limit: 20, filters: [], sort: { field: "createdAt", dir: "desc" } })
})

test("hidden: mutating a returned query does not change the next one", () => {
  const first = buildQuery()
  first.filters.push({ field: "x", value: "y" })
  first.sort.dir = "asc"
  expect(buildQuery()).toEqual({ limit: 20, filters: [], sort: { field: "createdAt", dir: "desc" } })
})
