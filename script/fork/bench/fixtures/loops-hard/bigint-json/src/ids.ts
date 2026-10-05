/** Ids are shown and linked as plain decimal strings, without separators or exponent notation. */
export function formatId(id: string | number | bigint): string {
  return typeof id === "string" ? id.trim() : BigInt(id).toString()
}
