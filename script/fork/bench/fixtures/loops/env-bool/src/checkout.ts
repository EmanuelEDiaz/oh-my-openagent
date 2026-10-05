import type { Env } from "./env"
import { isEnabled } from "./flags"

export function checkoutBanner(env: Env = process.env): string {
  if (!isEnabled("promo", env)) return ""
  return "Free shipping on orders over 50 €"
}
