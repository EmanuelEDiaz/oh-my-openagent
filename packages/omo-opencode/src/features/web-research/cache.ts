/**
 * 24 h search cache and quota memory (fork roadmap 4.18): keyless quotas are small (Exa ~150 calls a day), so the same
 * query is never paid twice, and a spent source is skipped until its quota resets.
 */
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { SearchHit } from "./sources"

const TTL_MS = 24 * 60 * 60_000

export function defaultCacheDir(): string {
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "omo-web-research")
}

export function createSearchCache(dir: string = defaultCacheDir(), now: () => number = Date.now) {
  const memory = new Map<string, { at: number; hits: SearchHit[] }>()
  const spentInMemory = new Map<string, number>()
  const file = (key: string) => join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`)
  const quotaFile = join(dir, "quota.json")

  function readQuota(): Record<string, number> {
    try {
      return existsSync(quotaFile) ? (JSON.parse(readFileSync(quotaFile, "utf8")) as Record<string, number>) : {}
    } catch {
      return {}
    }
  }

  return {
    get(source: string, query: string): SearchHit[] | undefined {
      const key = `${source}\n${query.toLowerCase().trim()}`
      const cached = memory.get(key)
      if (cached && now() - cached.at < TTL_MS) return cached.hits
      try {
        const path = file(key)
        if (!existsSync(path)) return undefined
        const stored = JSON.parse(readFileSync(path, "utf8")) as { at: number; hits: SearchHit[] }
        if (now() - stored.at >= TTL_MS) return undefined
        memory.set(key, stored)
        return stored.hits
      } catch {
        return undefined
      }
    },
    set(source: string, query: string, hits: SearchHit[]): void {
      const key = `${source}\n${query.toLowerCase().trim()}`
      const entry = { at: now(), hits }
      memory.set(key, entry)
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(file(key), JSON.stringify(entry))
      } catch {
        // the cache is an optimisation; a read-only disk only costs quota
      }
    },
    /** A source is spent until the next UTC midnight (Exa's daily quota). */
    markSpent(source: string): void {
      const midnight = new Date(now())
      midnight.setUTCHours(24, 0, 0, 0)
      const quota = { ...readQuota(), [source]: midnight.getTime() }
      try {
        mkdirSync(dir, { recursive: true })
        writeFileSync(quotaFile, JSON.stringify(quota))
      } catch {
        // remembered for this process only
      }
      spentInMemory.set(source, midnight.getTime())
    },
    isSpent(source: string): boolean {
      const until = spentInMemory.get(source) ?? readQuota()[source] ?? 0
      return until > now()
    },
  }
}


export type SearchCache = ReturnType<typeof createSearchCache>
