# date-parse

Calendar days as `YYYY-MM-DD` strings.

- `parseDay(text)` returns the `Date` at **UTC midnight** of that day, whatever the machine's time zone.
- `formatDay(date)` returns the UTC day of a date as `YYYY-MM-DD`.
- `addDays(text, n)` returns the day `n` days later (negative goes back), as `YYYY-MM-DD`.
