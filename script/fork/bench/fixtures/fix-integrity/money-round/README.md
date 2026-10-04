# money-round

`roundCents(amount)` rounds an amount of money to 2 decimals.

- Ties round **half away from zero**: `1.005 → 1.01`, `-1.005 → -1.01`.
- The amount is treated as the decimal number it is written as, so binary floating point
  representation (e.g. `1.005` being stored as `1.00499999…`) must not change the result.
