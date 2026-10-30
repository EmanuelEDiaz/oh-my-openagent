import { selectWhere } from "../db/query"

/** Ids of pending orders placed more than `days` days before `now`. */
export function stalePendingOrders(now: Date, days: number): string[] {
  const limit = now.getTime() - days * 86_400_000
  return selectWhere("orders", "status", "pending")
    .filter((record) => new Date(record.created_at).getTime() < limit)
    .map((record) => record.id)
}
