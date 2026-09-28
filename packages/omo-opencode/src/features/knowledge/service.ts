import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { log } from "../../shared/logger"
import { openKnowledgeStore } from "./store"
import type { KnowledgeStore, SearchOptions } from "./store"
import { syncProject } from "./sync"
import type { KnowledgeHit } from "./types"

const SYNC_DEBOUNCE_MS = 1500

export type KnowledgeService = {
  /** Debounced, single-flight background sync; never throws, never blocks the caller. */
  readonly scheduleSync: (reason: string) => void
  readonly syncNow: () => Promise<void>
  /** Waits for the first sync so the very first search already sees the project. */
  readonly search: (query: string, options?: SearchOptions) => Promise<KnowledgeHit[] | null>
  readonly close: () => void
}

export type KnowledgeServiceDeps = {
  readonly openStore?: typeof openKnowledgeStore
  readonly debounceMs?: number
}

/** Index files live under .omo/cache/ with their own .gitignore so they are never committed by accident. */
export function knowledgeStorePath(projectDir: string): string {
  const cacheDir = join(projectDir, ".omo", "cache")
  mkdirSync(cacheDir, { recursive: true })
  const ignore = join(cacheDir, ".gitignore")
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n")
  return join(cacheDir, "knowledge.db")
}

export function createKnowledgeService(projectDir: string, config: KnowledgeConfig | undefined, deps: KnowledgeServiceDeps = {}): KnowledgeService {
  let storePromise: Promise<KnowledgeStore | null> | undefined
  let running: Promise<void> | undefined
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let firstSync: Promise<void> | undefined

  const store = (): Promise<KnowledgeStore | null> => {
    storePromise ??= (deps.openStore ?? openKnowledgeStore)(knowledgeStorePath(projectDir)).catch((error: unknown) => {
      log("[knowledge] could not open index", { error: String(error) })
      return null
    })
    return storePromise
  }

  const runOnce = async (): Promise<void> => {
    const opened = await store()
    if (opened === null) return
    try {
      const stats = await syncProject({
        store: opened,
        projectDir,
        includePaths: config?.include_paths ?? [],
        gitCommits: config?.git_commits ?? 500,
      })
      if (stats.filesIndexed > 0 || stats.commitsIndexed > 0) log("[knowledge] synced", stats)
    } catch (error) {
      log("[knowledge] sync failed", { error: String(error) })
    }
  }

  const syncNow = async (): Promise<void> => {
    if (running) {
      pending = true
      return running
    }
    running = (async () => {
      do {
        pending = false
        await runOnce()
      } while (pending)
    })().finally(() => {
      running = undefined
    })
    return running
  }

  return {
    scheduleSync: (reason) => {
      if (timer) clearTimeout(timer)
      if (firstSync === undefined) {
        firstSync = syncNow()
        return
      }
      timer = setTimeout(() => {
        timer = undefined
        void syncNow()
      }, deps.debounceMs ?? SYNC_DEBOUNCE_MS)
      log("[knowledge] sync scheduled", { reason })
    },
    syncNow,
    search: async (query, options) => {
      firstSync ??= syncNow()
      await firstSync
      const opened = await store()
      return opened === null ? null : opened.search(query, options)
    },
    close: () => {
      if (timer) clearTimeout(timer)
      void store().then((opened) => opened?.close())
    },
  }
}

const services = new Map<string, KnowledgeService>()

/** One service per project directory, shared by the tool and the indexer hook. */
export function getKnowledgeService(projectDir: string, config: KnowledgeConfig | undefined): KnowledgeService {
  let service = services.get(projectDir)
  if (!service) {
    service = createKnowledgeService(projectDir, config)
    services.set(projectDir, service)
  }
  return service
}
