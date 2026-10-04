# pricer

`createPricer(options)` returns a cart pricer.

- `addDiscount(discount)` adds a percentage discount to **this** pricer only.
- `total(cents)` applies the pricer's discounts one after another, rounding to whole cents.
- Pricers never share discounts, and the `options.discounts` array passed in is never modified.
