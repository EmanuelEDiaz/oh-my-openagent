/** Email bodies; `{{name}}` placeholders are filled by `renderTemplate`. */
export const TEMPLATES = {
  orderConfirmation: "Hi {{customer_name}},\nthanks for your order {{order_id}}.\nYou pay: {{payable}}\n{{discount_line}}",
  orderShipped: "Hi {{customer_name}},\nyour order {{order_id}} is on its way.",
} as const
