import { customers, orderItems, orders, products } from "./seed"

const TABLES = { customers, products, orders, order_items: orderItems }

export type TableName = keyof typeof TABLES
export type RowOf<T extends TableName> = (typeof TABLES)[T][number]

export function selectAll<T extends TableName>(table: T): RowOf<T>[] {
  return [...TABLES[table]] as RowOf<T>[]
}

/** Rows whose `column` equals `value` (the column is named as in the database). */
export function selectWhere<T extends TableName>(table: T, column: string, value: unknown): RowOf<T>[] {
  return selectAll(table).filter((row) => (row as Record<string, unknown>)[column] === value)
}
