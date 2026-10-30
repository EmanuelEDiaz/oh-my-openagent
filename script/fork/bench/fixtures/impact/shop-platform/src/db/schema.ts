import { MIGRATIONS } from "./migrations"

const CREATE = /CREATE TABLE (\w+) \(([^;]+)\);/g
const ADD = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g
const DROP = /ALTER TABLE (\w+) DROP COLUMN (\w+)/g
const RENAME = /ALTER TABLE (\w+) RENAME COLUMN (\w+) TO (\w+)/g

/** Columns of every table after applying all migrations in order. */
export function tableColumns(): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  for (const sql of MIGRATIONS) {
    for (const [, table, body] of sql.matchAll(CREATE)) {
      tables.set(table!, body!.split(",").map((column) => column.trim().split(" ")[0]!))
    }
    for (const [, table, column] of sql.matchAll(ADD)) tables.get(table!)?.push(column!)
    for (const [, table, column] of sql.matchAll(DROP)) tables.set(table!, (tables.get(table!) ?? []).filter((name) => name !== column))
    for (const [, table, from, to] of sql.matchAll(RENAME)) tables.set(table!, (tables.get(table!) ?? []).map((name) => (name === from ? to! : name)))
  }
  return tables
}

/** Records whose keys differ from the table's columns, as readable problems. */
export function schemaProblems(table: string, records: readonly object[]): string[] {
  const columns = tableColumns().get(table)
  if (columns === undefined) return [`unknown table ${table}`]
  const expected = [...columns].sort().join(",")
  return records
    .map((record, index) => ({ index, keys: Object.keys(record).sort().join(",") }))
    .filter(({ keys }) => keys !== expected)
    .map(({ index, keys }) => `${table}[${index}] has ${keys}, expected ${expected}`)
}
