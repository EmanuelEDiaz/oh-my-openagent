import { selectWhere } from "../db/query"
import type { OrderLine } from "../domain/order"
import { findProduct } from "./products-repo"

export function linesOf(orderId: string): OrderLine[] {
  return selectWhere("order_items", "order_id", orderId).map((item) => ({
    title: findProduct(item.product_id)?.title ?? "(removed product)",
    quantity: item.quantity,
  }))
}
