import { apiUrl, getJson, type FetchLike } from "./http"

const RESOURCE = "orders"

/** The order JSON the client expects from the API. */
export type OrderView = {
  id: string
  customer: string
  status: "pending" | "paid" | "shipped"
  total: number
  discountCode: string | null
}

export function fetchOrder(fetchImpl: FetchLike, id: string): Promise<OrderView> {
  return getJson<OrderView>(fetchImpl, apiUrl(RESOURCE, id))
}

export function fetchOrders(fetchImpl: FetchLike): Promise<OrderView[]> {
  return getJson<OrderView[]>(fetchImpl, apiUrl(RESOURCE))
}
