/**
 * Hard impact suite (fork roadmap 0.27, docs/fork/plans/impact-map.md "Propuesta para las decisiones pendientes"): the
 * `impact` suite was saturated (24/24 with full coverage), because its apps fit in one read. `shop-platform` has 51
 * source files and dependents a search for the symbol does not find: SQL in migration strings, snake_case wire and
 * column names, field lists in `app-config.json`, `{{placeholders}}` in email templates, admin columns named by string,
 * a client that builds paths from segments, and a second money formatter on the client side. Prompts are short, as the
 * user writes them.
 *
 * Every task has a reference patch (fixtures/impact-hard-reference, checked by graders.test.ts: it applies, and with it
 * the visible tests, the hidden tests and the type check pass). `impact` lists the files every valid solution touches;
 * migrations, the README and files a solution may add are left out. Hidden tests decide the pass.
 */
import { join } from "node:path"

import { editStats, hiddenTestsPass, impactCoverage, integrityGraders, noNewTypeEscapes, typecheckPasses } from "../../graders"
import type { Budget, Task } from "../../types"

const BUDGET: Budget = { maxTurns: 60, timeoutMs: 1_200_000 }
const FIXTURES = join(import.meta.dir, "../../fixtures")
const FIXTURE = "impact/shop-platform"

type Case = {
  readonly id: string
  readonly level: "simple" | "hard" | "extreme"
  readonly prompt: string
  /** Files every valid solution touches (a subset of the reference patch). */
  readonly impact: readonly string[]
  readonly holdout?: boolean
}

const ORDER_FIELD = ["src/db/tables.ts", "src/db/seed.ts", "src/domain/order.ts", "src/repo/order-columns.ts", "src/api/wire.ts", "src/client/sdk/orders.ts"]

export const IMPACT_HARD_CASES: readonly Case[] = [
  {
    id: "delivery-date",
    level: "hard",
    prompt: "Customers and admins should see when an order will be delivered. Call it `deliveryDate`: o1 2026-11-03, o2 2026-11-10, o3 has none yet (show `pending`). Accounting wants it in their CSV too.",
    impact: [...ORDER_FIELD, "src/client/views/customer/order-page.ts", "src/client/views/admin/columns.ts", "src/config/app-config.json"],
  },
  {
    id: "api-amount",
    level: "extreme",
    prompt: "Partners get confused by `total_cents`. Rename it to `amount_cents` in everything we send out. The database and the accounting CSV keep `total_cents`.",
    impact: ["src/api/wire.ts", "src/client/sdk/orders.ts", "src/config/app-config.json"],
  },
  {
    id: "remove-discount",
    level: "hard",
    prompt: "We no longer offer discount codes. Remove them.",
    impact: [...ORDER_FIELD, "src/services/pricing.ts", "src/client/views/customer/order-page.ts", "src/client/views/admin/columns.ts", "src/notifications/order-mailer.ts", "src/config/app-config.json"],
  },
  {
    id: "rename-resource",
    level: "extreme",
    prompt: "Rename the orders resource of the API to `purchases`. The old path must stop working.",
    impact: ["src/api/resources.ts", "src/client/sdk/endpoints.ts"],
  },
  {
    id: "currency",
    level: "extreme",
    prompt: "Orders can be in EUR now: o2 is EUR, the rest are USD (field `currency`). EUR amounts look like `49,99 €`, USD stays `$12.50`, everywhere we show an order's money.",
    impact: [
      ...ORDER_FIELD,
      "src/domain/money.ts",
      "src/notifications/order-mailer.ts",
      "src/jobs/nightly-report.ts",
      "src/client/format/money.ts",
      "src/client/views/customer/order-page.ts",
      "src/client/views/customer/order-history.ts",
      "src/client/views/admin/orders-table.ts",
      "src/client/views/admin/order-detail.ts",
      "src/config/app-config.json",
    ],
  },
  {
    id: "split-name",
    level: "extreme",
    prompt: "Store customers' first and last names separately (`firstName`, `lastName`). Emails greet by first name; the admin screens show `Last, First`.",
    impact: ["src/db/tables.ts", "src/db/seed.ts", "src/domain/customer.ts", "src/repo/customers-repo.ts", "src/services/order-service.ts", "src/api/wire.ts", "src/client/sdk/customers.ts", "src/notifications/order-mailer.ts"],
  },
  {
    id: "status-filter",
    level: "simple",
    prompt: "Let the orders list be filtered by status: `?status=paid`. An unknown status is a 400. The client's `fetchOrders` should take an optional status.",
    impact: ["src/api/handlers/orders.ts", "src/client/sdk/orders.ts"],
    holdout: true,
  },
  {
    id: "tracking-number",
    level: "hard",
    prompt: "Shipped orders get a tracking number (`trackingNumber`; o3 is `TRK-3003`). Put it in the shipping email and the webhook, and show it on the customer's order page.",
    impact: [...ORDER_FIELD, "src/config/app-config.json", "src/notifications/templates.ts", "src/notifications/order-mailer.ts", "src/client/views/customer/order-page.ts"],
    holdout: true,
  },
]

export const IMPACT_HARD_TASKS: readonly Task[] = IMPACT_HARD_CASES.map((item) => {
  const originalDir = join(FIXTURES, FIXTURE)
  return {
    id: `impact-hard/${item.level}-${item.id}`,
    agent: "Sisyphus - ultraworker",
    mode: "primary" as const,
    fixture: FIXTURE,
    prompt: item.prompt,
    expect: [
      hiddenTestsPass(originalDir, join(FIXTURES, "impact-hard-hidden", `${item.id}.hidden.ts`)),
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
