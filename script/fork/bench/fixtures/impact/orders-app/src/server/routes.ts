import { getOrder, getOrders } from "./handlers"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405)
  if (url.pathname === "/api/orders") return json(getOrders())
  const match = /^\/api\/orders\/([^/]+)$/.exec(url.pathname)
  if (match?.[1]) {
    const order = getOrder(match[1])
    return order ? json(order) : json({ error: "not found" }, 404)
  }
  return json({ error: "not found" }, 404)
}
