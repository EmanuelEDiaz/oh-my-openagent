import { allCustomers, getCustomer } from "../../services/customer-service"
import { json, notFound } from "../json"
import { CUSTOMER_WIRE, toWire } from "../wire"

export function listCustomersHandler(): Response {
  return json(allCustomers().map((customer) => toWire(customer, CUSTOMER_WIRE)))
}

export function getCustomerHandler(id: string): Response {
  const customer = getCustomer(id)
  return customer === undefined ? notFound() : json(toWire(customer, CUSTOMER_WIRE))
}
