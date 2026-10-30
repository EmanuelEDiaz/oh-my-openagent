import { ENDPOINTS } from "./endpoints"
import { apiPath, getJson, type FetchLike } from "./http"

/** An order as the client screens use it. */
export type OrderView = {
  id: string
  customer: string
  status: string
  total: number
  payable: number
  discount: string | null
  placedAt: string
  items: { title: string; quantity: number }[]
}

type Wire = Record<string, unknown>

function fromWire(raw: Wire): OrderView {
  return {
    id: String(raw["id"]),
    customer: String(raw["customer_name"]),
    status: String(raw["status"]),
    total: Number(raw["total_cents"]),
    payable: Number(raw["payable_cents"]),
    discount: raw["discount_code"] == null ? null : String(raw["discount_code"]),
    placedAt: String(raw["created_at"]),
    items: (raw["items"] as OrderView["items"] | undefined) ?? [],
  }
}

export async function fetchOrder(fetchImpl: FetchLike, id: string): Promise<OrderView> {
  return fromWire(await getJson<Wire>(fetchImpl, apiPath(ENDPOINTS.orders, id)))
}

export async function fetchOrders(fetchImpl: FetchLike): Promise<OrderView[]> {
  return (await getJson<Wire[]>(fetchImpl, apiPath(ENDPOINTS.orders))).map(fromWire)
}
