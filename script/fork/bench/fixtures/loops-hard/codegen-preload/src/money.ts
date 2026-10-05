import { CURRENCIES } from "./generated/currencies"

export function formatMoney(minor: number, code: string): string {
  const currency = CURRENCIES[code]
  if (!currency) throw new Error(`unknown currency ${code}`)
  const value = minor / 10 ** currency.decimals
  const text = value.toLocaleString("en-US", { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals })
  return `${currency.symbol}${text}`
}
