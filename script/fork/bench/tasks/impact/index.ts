/**
 * Impact suite (fork roadmap 0.27, docs/fork/plans/impact-map.md "Primera versión medible"): changes whose prompt names
 * one place but whose complete fix crosses layers (database row → handler → API → client type → view), as in the user's
 * report that OpenCode "touches only the button or the controller, ignoring its dependencies".
 *
 * Solved means the visible tests, hidden tests (fixtures/impact-hidden, never copied into the workdir) and a clean type
 * check pass, without new type escapes or edited tests. `info:impact` reports how many of the reference patch's files
 * were touched and which were skipped without a word; it never fails a run.
 *
 * Levels: simple (2 to 3 files, named in the prompt or one hop away), hard (4 or 5 files across both sides), extreme (a
 * signature change with callers on both sides, or a URL the client builds from a constant, so no text search finds it).
 */
import { join } from "node:path"

import { editStats, hiddenTestsPass, impactCoverage, integrityGraders, noNewTypeEscapes, typecheckPasses } from "../../graders"
import type { Budget, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 40, timeoutMs: 900_000 }
const FIXTURES = join(import.meta.dir, "../../fixtures")

type Case = {
  readonly id: string
  readonly app: "orders-app" | "ts-service"
  readonly level: "simple" | "hard" | "extreme"
  readonly prompt: string
  /** Files the reference patch touches. */
  readonly impact: readonly string[]
  readonly holdout?: boolean
}

const CASES: readonly Case[] = [
  {
    id: "status-filter",
    app: "orders-app",
    level: "simple",
    prompt: "Add a status filter to the order list endpoint: `GET /api/orders?status=paid` returns only paid orders, and an unknown status is a 400. The client's `fetchOrders` should accept an optional status.",
    impact: ["src/server/routes.ts", "src/client/orders-api.ts"],
    holdout: true,
  },
  {
    id: "validate-email",
    app: "ts-service",
    level: "simple",
    prompt: "Replace `isValidEmail` with `validateEmail(value)`, which returns `{ ok: boolean; reason?: string }` (a reason when it is not ok). Remove `isValidEmail`.",
    impact: ["src/users/validate.ts", "src/users/service.ts", "src/admin/invite.ts"],
  },
  {
    id: "delivery-date",
    app: "orders-app",
    level: "hard",
    prompt: "On the order page, show the delivery date as `Delivery: <date>` below the total. Call the field `deliveryDate`. Dates: o1 2026-11-03, o2 2026-11-10, o3 2026-10-30.",
    impact: ["src/db/schema.ts", "src/db/store.ts", "src/server/handlers.ts", "src/client/orders-api.ts", "src/client/order-view.ts"],
  },
  {
    id: "rename-total",
    app: "orders-app",
    level: "hard",
    prompt: "In the API, rename the order field `total` to `totalCents`, since it is in cents. Keep the database column as it is.",
    impact: ["src/server/handlers.ts", "src/server/receipt.ts", "src/client/orders-api.ts", "src/client/order-view.ts"],
  },
  {
    id: "remove-discount",
    app: "orders-app",
    level: "hard",
    prompt: "Remove the deprecated `discountCode`.",
    impact: ["src/db/schema.ts", "src/db/store.ts", "src/server/handlers.ts", "src/client/orders-api.ts", "src/client/order-view.ts"],
  },
  {
    id: "token-from-config",
    app: "ts-service",
    level: "hard",
    prompt: "`bearerHeader` reads `API_TOKEN` from the environment by itself. Make it take the token from the loaded config instead, so only `config.ts` reads the environment.",
    impact: ["src/auth/token.ts", "src/http/client.ts", "src/index.ts"],
    holdout: true,
  },
  {
    id: "currency",
    app: "orders-app",
    level: "extreme",
    prompt: "Orders can now be in USD or EUR: o2 is EUR, the others are USD. Make `formatMoney` take the currency: USD stays `$12.50`, EUR is `12,50 €`. Call the order field `currency`.",
    impact: ["src/shared/money.ts", "src/db/schema.ts", "src/db/store.ts", "src/server/handlers.ts", "src/server/receipt.ts", "src/client/orders-api.ts", "src/client/order-view.ts"],
  },
  {
    id: "rename-route",
    app: "orders-app",
    level: "extreme",
    prompt: "Rename the orders API resource to `/api/purchases`. The old path should stop working.",
    impact: ["src/server/routes.ts", "src/client/orders-api.ts"],
  },
]

export const IMPACT_TASKS: readonly Task[] = CASES.map((item) => {
  const fixture = `impact/${item.app}`
  const originalDir = join(FIXTURES, fixture)
  return {
    id: `impact/${item.level}-${item.id}`,
    agent: "Sisyphus - ultraworker",
    mode: "primary" as const,
    fixture,
    prompt: item.prompt,
    expect: [
      hiddenTestsPass(originalDir, join(FIXTURES, "impact-hidden", `${item.id}.hidden.ts`)),
      typecheckPasses(originalDir),
      ...integrityGraders(originalDir),
      noNewTypeEscapes(originalDir),
      impactCoverage(originalDir, item.impact),
      editStats(),
    ],
    split: item.holdout ? ("holdout" as const) : ("dev" as const),
    budget: BUDGET,
  }
})
