/** Rows as stored: snake_case, one type per table. */
export type CustomerRecord = { id: string; name: string; email: string }

export type ProductRecord = { id: string; title: string; price_cents: number }

export type OrderRecord = {
  id: string
  customer_id: string
  status: string
  total_cents: number
  discount_code: string | null
  created_at: string
}

export type OrderItemRecord = { order_id: string; product_id: string; quantity: number }
