import { ORDER_WIRE, toWire } from "../api/wire"
import { config } from "../config/config"
import type { OrderSummary } from "../services/order-service"
import { signature } from "./sign"

export type OrderEvent = "order.created" | "order.shipped"

export type WebhookDelivery = { body: string; headers: Record<string, string> }

/** The event as receivers get it: only the configured order fields, under their API names. */
export function orderEventPayload(event: OrderEvent, order: OrderSummary): Record<string, unknown> {
  const wire = toWire(order, ORDER_WIRE)
  const data = Object.fromEntries(config.webhooks.orderFields.map((field) => [field, wire[field]]))
  return { event, data }
}

export function deliveryFor(event: OrderEvent, order: OrderSummary): WebhookDelivery {
  const body = JSON.stringify(orderEventPayload(event, order))
  return { body, headers: { "content-type": "application/json", "x-shop-signature": signature(body, config.webhooks.secret) } }
}
