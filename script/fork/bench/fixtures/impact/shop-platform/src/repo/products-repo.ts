import { selectAll, selectWhere } from "../db/query"
import type { Product } from "../domain/product"

export function findProduct(id: string): Product | undefined {
  const [record] = selectWhere("products", "id", id)
  return record === undefined ? undefined : { id: record.id, title: record.title, priceCents: record.price_cents }
}

export function listProducts(): Product[] {
  return selectAll("products").map((record) => ({ id: record.id, title: record.title, priceCents: record.price_cents }))
}
