# shop-platform

Small shop backend and its clients: database tables, repositories, services, a JSON API, a client SDK with customer and
admin views, order emails, webhooks, CSV export, nightly jobs and order search.

Run the tests with `bun test` and the type check with `bun run typecheck`.

## API

All JSON fields are snake_case.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v2/orders` | every order |
| GET | `/api/v2/orders/:id` | one order, or 404 |
| GET | `/api/v2/customers` | every customer |
| GET | `/api/v2/customers/:id` | one customer, or 404 |
| GET | `/api/v2/products` | every product |

An order: `id`, `customer_id`, `customer_name`, `status`, `total_cents`, `payable_cents`, `discount_code`, `created_at`,
`items` (`title`, `quantity`).
