import { getOrderSummary, listOrderSummaries } from "../../services/order-service"
import { json, notFound } from "../json"
import { ORDER_WIRE, toWire } from "../wire"

export function listOrdersHandler(_url: URL): Response {
  return json(listOrderSummaries().map((summary) => toWire(summary, ORDER_WIRE)))
}

export function getOrderHandler(id: string): Response {
  const summary = getOrderSummary(id)
  return summary === undefined ? notFound() : json(toWire(summary, ORDER_WIRE))
}
