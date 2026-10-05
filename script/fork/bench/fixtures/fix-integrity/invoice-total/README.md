# invoice-total

Reads invoice lines exported as CSV (`sku,quantity,unitPrice`, with a header row) and totals them.

- `parseLines(csv)` returns one `Line` per data row; blank lines are ignored.
- `lineTotal(line)` is `quantity × unitPrice`; `line.amount` is the same value printed with two decimals.
- `invoiceTotal(lines)` is the sum of the line totals, rounded to cents (0 for no lines).
- `totalQuantity(lines)` is the number of units on the invoice.
- `sumBy(items, key)` (src/sum.ts) is the shared helper that adds up a numeric field.
- `bun test` runs the tests; `bun run typecheck` checks the types.
