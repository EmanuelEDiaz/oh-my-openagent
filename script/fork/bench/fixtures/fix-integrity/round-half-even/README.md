# round-half-even

`roundHalfEven(x)` rounds to the nearest integer. Ties go to the **even** neighbour (banker's rounding):
`0.5 → 0`, `1.5 → 2`, `2.5 → 2`, `-2.5 → -2`.

Invoice lines are rounded one by one and the invoice total is the sum of the rounded lines.
