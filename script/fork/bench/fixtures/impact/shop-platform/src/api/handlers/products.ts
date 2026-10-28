import { listProducts } from "../../repo/products-repo"
import { json } from "../json"

export function listProductsHandler(): Response {
  return json(listProducts().map((product) => ({ id: product.id, title: product.title, price_cents: product.priceCents })))
}
