/**
 * Local store of test credentials (fork roadmap 0.21, entrega 2): `<project>/.omo/secrets/credentials.json`, folder
 * 0700 and file 0600, with its own `.gitignore` (`*`) so it never reaches git even when `.omo/` is not ignored. A value
 * that changes keeps the old one in its history: a test database created with the old password still needs it.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "../../shared/logger"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import type { CapturedCredential } from "./capture"

export type StoredCredential = Omit<CapturedCredential, "origin"> & {
  readonly origin: string
  readonly session?: string
  readonly savedAt: string
  readonly history: readonly { readonly value: string; readonly replacedAt: string }[]
}

export type CredentialInput = Omit<StoredCredential, "savedAt" | "history">

/** Shorter values are not redacted by value: "1234" would blank ordinary numbers in every output. */
export const MIN_REDACT_LENGTH = 6

type StoreFile = { readonly credentials: Record<string, StoredCredential> }

export function createCredentialStore(directory: string) {
  const folder = join(directory, ".omo", "secrets")
  const file = join(folder, "credentials.json")

  const read = (): Record<string, StoredCredential> => {
    if (!existsSync(file)) return {}
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<StoreFile>
      return parsed.credentials && typeof parsed.credentials === "object" ? { ...parsed.credentials } : {}
    } catch (error) {
      // Never overwrite what cannot be read: it may hold the only copy of a password.
      const aside = `${file}.unreadable-${Date.now()}`
      renameSync(file, aside)
      log("[credentials] store unreadable, moved aside", { aside, error: String(error) })
      return {}
    }
  }

  const write = (credentials: Record<string, StoredCredential>) => {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    chmodSync(folder, 0o700)
    const ignore = join(folder, ".gitignore")
    if (!existsSync(ignore)) writeFileSync(ignore, "*\n")
    writeFileAtomically(file, `${JSON.stringify({ credentials }, null, 2)}\n`, { mode: 0o600 })
    chmodSync(file, 0o600)
  }

  return {
    path: file,

    save(input: CredentialInput): "saved" | "updated" | "unchanged" {
      const credentials = read()
      const previous = credentials[input.name]
      if (previous?.value === input.value) return "unchanged"
      const now = new Date().toISOString()
      const history = previous ? [...previous.history, { value: previous.value, replacedAt: now }] : []
      credentials[input.name] = { ...input, savedAt: now, history }
      write(credentials)
      return previous ? "updated" : "saved"
    },

    get(name: string): StoredCredential | undefined {
      return read()[name]
    },

    /** Everything but the values. */
    list(): Omit<StoredCredential, "value" | "history">[] {
      return Object.values(read()).map(({ value: _value, history: _history, ...rest }) => rest)
    },

    /** Current and old values long enough to redact, with the name to show instead. */
    redactable(): { name: string; value: string }[] {
      return Object.values(read())
        .flatMap((entry) => [entry.value, ...entry.history.map((old) => old.value)].map((value) => ({ name: entry.name, value })))
        .filter((item) => item.value.length >= MIN_REDACT_LENGTH)
    },
  }
}

export type CredentialStore = ReturnType<typeof createCredentialStore>
