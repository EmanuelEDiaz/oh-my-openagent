# orders

`parseOrders(body)` reads the orders API response (a JSON array of `{ "id": <integer>, "total": <number> }`).
Order ids are 64-bit integers from the upstream database; we keep them as **strings** (`Order.id`) so they survive
untouched. Totals stay numbers. `orderUrl(order)` builds the dashboard link from the id.
