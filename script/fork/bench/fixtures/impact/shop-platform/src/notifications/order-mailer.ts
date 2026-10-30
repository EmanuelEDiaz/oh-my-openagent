import { formatMoney } from "../domain/money"
import type { OrderSummary } from "../services/order-service"
import { renderTemplate } from "./render"
import { TEMPLATES } from "./templates"

export type Email = { to: string; subject: string; body: string }

export function confirmationEmail(order: OrderSummary): Email {
  const body = renderTemplate(TEMPLATES.orderConfirmation, {
    customer_name: order.customerName,
    order_id: order.id,
    payable: formatMoney(order.payableCents),
    discount_line: order.discountCode === null ? "" : `Discount ${order.discountCode} applied.`,
  })
  return { to: order.customerEmail, subject: `Order ${order.id} confirmed`, body }
}

export function shippedEmail(order: OrderSummary): Email {
  const body = renderTemplate(TEMPLATES.orderShipped, { customer_name: order.customerName, order_id: order.id })
  return { to: order.customerEmail, subject: `Order ${order.id} shipped`, body }
}
