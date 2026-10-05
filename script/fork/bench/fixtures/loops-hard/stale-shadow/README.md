# checkout

`checkoutTotal(cart)` sums the cart lines (in cents) and applies the cart's discount code, if any.

Discount codes (`DISCOUNTS` in `src/pricing.ts`):

- `SAVE10`: 10 **percent** off the subtotal, rounded to the nearest cent.
- `FIVEOFF`: 500 cents off, never below 0.
- Unknown codes are ignored.
