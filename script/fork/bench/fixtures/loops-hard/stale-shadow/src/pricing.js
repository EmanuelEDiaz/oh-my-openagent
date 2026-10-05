// src/pricing.ts
var DISCOUNTS = {
  SAVE10: { kind: "percent", amount: 10 },
  FIVEOFF: { kind: "fixed", amount: 500 }
};
function applyDiscount(subtotal, code) {
  const discount = code === undefined ? undefined : DISCOUNTS[code];
  if (!discount)
    return subtotal;
  return Math.max(0, subtotal - discount.amount);
}
export {
  applyDiscount,
  DISCOUNTS
};
