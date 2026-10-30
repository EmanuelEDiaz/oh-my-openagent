/** Columns of the admin orders table: the order field shown and its header. */
export type Column = { field: string; header: string; money?: boolean }

export const ORDER_TABLE_COLUMNS: readonly Column[] = [
  { field: "id", header: "Order" },
  { field: "customer", header: "Customer" },
  { field: "status", header: "Status" },
  { field: "total", header: "Total", money: true },
  { field: "discount", header: "Discount" },
]
