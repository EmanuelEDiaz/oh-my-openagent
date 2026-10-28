import { handle } from "../api/router"
import { fetchOrders } from "../client/sdk/orders"
import { renderOrdersTable } from "../client/views/admin/orders-table"

/** `bun src/scripts/print-orders.ts`: the admin table against the in-process API. */
export async function printOrders(): Promise<string> {
  return renderOrdersTable(await fetchOrders((url) => handle(new Request(`http://shop.local${url}`))))
}
