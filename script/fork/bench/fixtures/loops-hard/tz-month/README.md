# booking days

Booking days are calendar days written `YYYY-MM-DD`. `addDays(day, n)` returns the day `n` days later (or earlier
for a negative `n`); `nightsBetween(from, to)` counts the nights between two days. Results must not depend on the
machine's time zone: the test setup pins the zone of our booking office (`America/Los_Angeles`) on purpose.
