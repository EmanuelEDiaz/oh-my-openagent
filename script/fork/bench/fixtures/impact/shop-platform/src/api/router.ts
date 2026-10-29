import { config } from "../config/config"
import { getCustomerHandler, listCustomersHandler } from "./handlers/customers"
import { getOrderHandler, listOrdersHandler } from "./handlers/orders"
import { listProductsHandler } from "./handlers/products"
import { json, notFound } from "./json"
import { RESOURCES } from "./resources"

type Route = { list: (url: URL) => Response; one?: (id: string) => Response }

const ROUTES: Record<string, Route> = {
  [RESOURCES.orders]: { list: listOrdersHandler, one: getOrderHandler },
  [RESOURCES.customers]: { list: () => listCustomersHandler(), one: getCustomerHandler },
  [RESOURCES.products]: { list: () => listProductsHandler() },
}

export async function handle(request: Request): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405)
  const url = new URL(request.url)
  const prefix = `${config.api.base}/`
  if (!url.pathname.startsWith(prefix)) return notFound()
  const [resource, id, ...rest] = url.pathname.slice(prefix.length).split("/")
  const route = resource === undefined ? undefined : ROUTES[resource]
  if (route === undefined || rest.length > 0) return notFound()
  if (id === undefined || id === "") return route.list(url)
  return route.one ? route.one(decodeURIComponent(id)) : notFound()
}
