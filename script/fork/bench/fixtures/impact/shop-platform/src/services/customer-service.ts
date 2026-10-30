import type { Customer } from "../domain/customer"
import { findCustomer, listCustomers } from "../repo/customers-repo"

export function getCustomer(id: string): Customer | undefined {
  return findCustomer(id)
}

export function allCustomers(): Customer[] {
  return listCustomers()
}
