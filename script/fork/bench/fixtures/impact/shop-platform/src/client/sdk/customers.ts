import { ENDPOINTS } from "./endpoints"
import { apiPath, getJson, type FetchLike } from "./http"

export type CustomerView = { id: string; name: string; email: string }

export async function fetchCustomer(fetchImpl: FetchLike, id: string): Promise<CustomerView> {
  const raw = await getJson<Record<string, unknown>>(fetchImpl, apiPath(ENDPOINTS.customers, id))
  return { id: String(raw["id"]), name: String(raw["name"]), email: String(raw["email"]) }
}
