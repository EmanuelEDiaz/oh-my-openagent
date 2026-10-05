import { expect, test } from "bun:test"

import { buildQuery } from "../src/query"

test("status filter", () => {
  expect(buildQuery({ status: "open" }).filters).toEqual([{ field: "status", value: "open" }])
})

test("tenant scope", () => {
  expect(buildQuery({ tenant: "acme" }).filters).toEqual([{ field: "tenant", value: "acme" }])
})

test("oldest first", () => {
  expect(buildQuery({ oldestFirst: true }).sort).toEqual({ field: "createdAt", dir: "asc" })
})

test("the default query", () => {
  expect(buildQuery()).toEqual({ limit: 20, filters: [], sort: { field: "createdAt", dir: "desc" } })
})
