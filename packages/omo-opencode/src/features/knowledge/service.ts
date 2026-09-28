import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { KnowledgeConfig } from "../../config/schema/knowledge"
import { getDataDir } from "../../shared/data-path"
import { log } from "../../shared/logger"
import { decisionPaths } from "./decision-files"
import { refreshPlanLinks } from "./plan-links"
import { openSessionLocator } from "./session-open"
import { openSessionReader } from "./session-reader"
import { pinSessions, syncSessions } from "./session-sync"
import { openKnowledgeStore } from "./store"
import type { KnowledgeStore, SearchOptions } from "./store"
import { syncProject } from "./sync"
import type { KnowledgeHit } from "./types"

const SYNC_DEBOUNCE_MS = 1500

export type KnowledgeScope = "project" | "all"

export type KnowledgeService = {
  /** Debounced, single-flight background sync; never throws, never blocks the caller. */
  readonly scheduleSync: (reason: string) => void
  readonly syncNow: () => Promise<void>
  /** Waits for the first sync so the very first search already sees the project. */
  readonly search: (query: string, options?: SearchOptions & { readonly scope?: KnowledgeScope }) => Promise<KnowledgeHit[] | null>
  /** Original conversation around a ses_…/msg_…/prt_… citation (read-only). */
  readonly open: (locator: string, around?: number) => Promise<string>
  readonly close: () => void
}

export type KnowledgeServiceDeps = {
  readonly openStore?: typeof openKnowledgeStore
  readonly openSessionStore?: () => Promise<KnowledgeStore | null>
  readonly opencodeDbPath?: string
  readonly debounceMs?: number
  readonly now?: () => number
}

const SESSION_REFERENCE_PATTERN = /\bses_[A-Za-z0-9]{8,}\b/g

export function opencodeDbPath(): string {
  return join(getDataDir(), "opencode", "opencode.db")
}

let sharedSessionStore: Promise<KnowledgeStore | null> | undefined

/** The session index is global (OpenCode keeps all projects' sessions in one database). */
function openSharedSessionStore(): Promise<KnowledgeStore | null> {
  sharedSessionStore ??= (async () => {
    const dir = join(getDataDir(), "opencode", "omo")
    mkdirSync(dir, { recursive: true })
    return openKnowledgeStore(join(dir, "sessions-index.db"))
  })().catch((error: unknown) => {
    log("[knowledge] could not open session index", { error: String(error) })
    return null
  })
  return sharedSessionStore
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
  let projectId: string | undefined
  const indexSessions = config?.index_sessions !== false
  const dbPath = deps.opencodeDbPath ?? opencodeDbPath()
  const sessionStore = (): Promise<KnowledgeStore | null> =>
    indexSessions ? (deps.openSessionStore ?? openSharedSessionStore)() : Promise.resolve(null)

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
      refreshPlansIfDecisionsChanged(opened)
    } catch (error) {
      log("[knowledge] sync failed", { error: String(error) })
    }
    void syncSessionIndex(opened)
  }

  /** Decision files edited by hand (or by another branch) → regenerate the plans' link blocks. */
  const refreshPlansIfDecisionsChanged = (projectStore: KnowledgeStore): void => {
    const fingerprint = (): string => {
      const hash = createHash("sha1")
      for (const path of decisionPaths(projectDir)) hash.update(path).update(readFileSync(join(projectDir, path)))
      return hash.digest("hex")
    }
    if (projectStore.getMeta("decisions_fingerprint") === fingerprint()) return
    const rewritten = refreshPlanLinks(projectDir)
    if (rewritten.length > 0) log("[knowledge] refreshed plan decision links", { rewritten })
    projectStore.setMeta("decisions_fingerprint", fingerprint())
  }

  const syncSessionIndex = async (projectStore: KnowledgeStore): Promise<void> => {
    const sessions = await sessionStore()
    if (sessions === null) return
    const reader = await openSessionReader(dbPath)
    if (reader === null) return
    try {
      projectId = reader.projectIdFor(projectDir)
      const references = projectStore.bodiesContaining("ses_").flatMap(({ source, body }) =>
        [...body.matchAll(SESSION_REFERENCE_PATTERN)].map((match) => ({ sessionId: match[0], source })))
      pinSessions(sessions, references)
      const stats = syncSessions({
        store: sessions,
        reader,
        now: (deps.now ?? Date.now)(),
        retentionDays: config?.session_retention_days ?? 180,
        maxIndexMb: config?.max_index_mb ?? 200,
      })
      if (stats.sessionsIndexed > 0 || stats.sessionsRemoved > 0) log("[knowledge] sessions synced", stats)
    } catch (error) {
      log("[knowledge] session sync failed", { error: String(error) })
    } finally {
      reader.close()
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
    search: async (query, options = {}) => {
      firstSync ??= syncNow()
      await firstSync
      const opened = await store()
      if (opened === null) return null
      const limit = options.limit ?? 8
      const projectHits = opened.search(query, { ...options, limit })
      const sessions = await sessionStore()
      const sessionHits = sessions === null
        ? []
        : sessions.search(query, { ...options, limit, ...(options.scope === "all" || projectId === undefined ? {} : { projectId }) })
      return [...projectHits, ...sessionHits].sort((left, right) => right.score - left.score).slice(0, limit)
    },
    open: async (locator, around) => {
      const reader = await openSessionReader(dbPath)
      if (reader === null) return "OpenCode session database is not available in this runtime."
      try {
        return openSessionLocator(reader, locator, around)
      } finally {
        reader.close()
      }
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
