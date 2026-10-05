/** Adds up a numeric field of every item. */
export function sumBy<T>(items: readonly T[], key: keyof T): number {
  let total = 0
  for (const item of items) total += item[key]
  return total
}
