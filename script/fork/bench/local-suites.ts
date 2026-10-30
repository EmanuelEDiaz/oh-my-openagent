/**
 * Suites that must never be committed (a private project of the user's, docs/fork/plans/real-project-bench.md): each
 * folder under `.omo/private/` with a `suite.ts` exporting `SUITES`. Their results and reports stay in that folder.
 */
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { Task } from "./types"

export type LocalSuite = { readonly tasks: readonly Task[]; readonly outDir: string }

export async function loadLocalSuites(root: string, builtIn: readonly string[]): Promise<Record<string, LocalSuite>> {
  if (!existsSync(root)) return {}
  const suites: Record<string, LocalSuite> = {}
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = join(root, entry.name, "suite.ts")
    if (!entry.isDirectory() || !existsSync(file)) continue
    const module = (await import(file)) as { SUITES?: Record<string, readonly Task[]> }
    for (const [name, tasks] of Object.entries(module.SUITES ?? {})) {
      if (builtIn.includes(name) || name in suites) throw new Error(`local suite ${name} in ${file} reuses an existing suite name`)
      suites[name] = { tasks, outDir: join(root, entry.name) }
    }
  }
  return suites
}
