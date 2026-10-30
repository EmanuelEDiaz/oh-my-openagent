import { ORDER_WIRE, toWire } from "../api/wire"
import { config } from "../config/config"
import { listOrderSummaries } from "../services/order-service"

function tokens(value: unknown): string[] {
  return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** Ids of the orders where every word of `query` appears in one of the configured search fields. */
export function searchOrders(query: string): string[] {
  const words = tokens(query)
  return listOrderSummaries()
    .filter((order) => {
      const wire = toWire(order, ORDER_WIRE)
      const haystack = new Set(config.search.orderFields.flatMap((field) => tokens(wire[field])))
      return words.every((word) => haystack.has(word))
    })
    .map((order) => order.id)
}
