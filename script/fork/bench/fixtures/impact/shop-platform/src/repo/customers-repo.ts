import { selectAll, selectWhere } from "../db/query"
import type { CustomerRecord } from "../db/tables"
import type { Customer } from "../domain/customer"

function toCustomer(record: CustomerRecord): Customer {
  return { id: record.id, name: record.name, email: record.email }
}

export function findCustomer(id: string): Customer | undefined {
  const [record] = selectWhere("customers", "id", id)
  return record === undefined ? undefined : toCustomer(record)
}

export function listCustomers(): Customer[] {
  return selectAll("customers").map(toCustomer)
}
