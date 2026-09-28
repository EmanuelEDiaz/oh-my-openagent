export type SqliteModule = typeof import("bun:sqlite")
export type SqliteDatabase = import("bun:sqlite").Database

let cached: Promise<SqliteModule | null> | undefined

/**
 * bun:sqlite only exists under Bun. The plugin can also be loaded by Node/Electron hosts, where a
 * static `bun:` import fails at parse time, so the module is imported lazily and `null` means
 * "SQLite unavailable here" (callers must degrade gracefully).
 */
export function loadSqlite(): Promise<SqliteModule | null> {
  cached ??= (async () => {
    if (typeof (globalThis as { Bun?: unknown }).Bun === "undefined") return null
    try {
      const dynamicImport = new Function("return import('bun:sqlite')") as () => Promise<SqliteModule>
      return await dynamicImport()
    } catch {
      return null
    }
  })()
  return cached
}
