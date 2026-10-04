export type Row = Record<string, string>

export function parseCsv(text: string): Row[] {
  const [header, ...lines] = text.trim().split("\n")
  if (header === undefined) return []
  const columns = header.split(",")
  return lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const cells = line.split(",")
      return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? ""]))
    })
}
