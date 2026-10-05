# invoice money

Amounts are plain numbers in euros. `round2(amount)` rounds an amount to cents the way the tax office does: on the
decimal value as written, **half away from zero** (`1.005` → `1.01`, `-1.005` → `-1.01`, `1.0049` → `1`).

`lineTotal(line)` is `round2(line.unitPrice * line.qty)` and `formatEuro(amount)` prints it with two decimals.
