import { selectAll } from "../db/query"
import { formatMoney } from "../domain/money"
import { ORDER_STATUSES } from "../domain/status"

/** Revenue per status, from the orders table. */
export function nightlyReport(): string {
  const records = selectAll("orders")
  return ORDER_STATUSES.map((status) => {
    const cents = records.filter((record) => record.status === status).reduce((sum, record) => sum + record.total_cents, 0)
    return `${status}: ${formatMoney(cents)}`
  }).join("\n")
}
