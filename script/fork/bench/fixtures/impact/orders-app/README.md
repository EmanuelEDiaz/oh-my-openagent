# orders-app

A small order tracker with a backend and a frontend in one repo.

- `src/db`: the order table (`schema.ts`) and its in-memory store with the seed data (`store.ts`).
- `src/server`: HTTP handlers and routes. `handle(request)` answers `GET /api/orders` and `GET /api/orders/:id` with JSON.
- `src/client`: the browser side: `http.ts` builds API URLs and fetches JSON, `orders-api.ts` calls the API,
  `order-view.ts` renders the order page and the order list as text lines.
- `src/shared/money.ts`: money formatting used by both sides.

The client and the server do not share types: the client describes the JSON it expects in `orders-api.ts`.

Money is stored in cents. `bun test` runs the tests; `bun run typecheck` checks types.
