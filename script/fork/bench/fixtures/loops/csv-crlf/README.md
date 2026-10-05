# ledger

`totalsByCategory(csvText)` sums the `amount` column of a CSV export per `category`.

`parseCsv(text)` reads simple CSV (no quoting): the first line is the header, each later line becomes an object
keyed by header name. Files come from Windows and Unix machines, so both `\n` and `\r\n` line endings are valid;
blank lines are ignored.
