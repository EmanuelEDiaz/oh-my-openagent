# money

`formatMoney(minor, code)` formats an amount given in the currency's minor units (cents for USD, fils for KWD, and
plain yen for JPY, which has no minor unit) as `<symbol><amount>` with thousands separators and exactly the
currency's number of decimals.

Currency data lives in `schema/currencies.json` (ISO 4217 `minor_units`); `src/generated/currencies.ts` is built from
it by `bun run codegen`.
