/**
 * Existing tests changed from the shell (fork roadmap 0.9a). The write tools are checked before they run, but a shell
 * command can rewrite a test in any number of ways (`sed -i`, `>`, `mv`, a script); the bench saw a model do exactly
 * that once its edits were refused (19-10-2026). Parsing commands cannot catch them all, so the state is compared
 * instead: before the command, note HEAD and copy the few tests that already differ from it; after it, put back every
 * existing test that changed. Git keeps this cheap (~60 ms on a repo with 3,500 tests); without git, every test is
 * copied, up to a limit.
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from "node:fs"
import { join, relative } from "node:path"

import { spawnSync } from "../../shared/bun-spawn-shim"
import { log } from "../../shared/logger"
import { isTestFile } from "./test-files"

const MAX_COPY_FILES = 2_000
const MAX_COPY_BYTES = 20_000_000

export type TestSnapshot = {
  readonly directory: string
  /** HEAD before the command; undefined outside a git repository. */
  readonly head: string | undefined
  /** Test contents taken before the command (undefined: the file did not exist). */
  readonly copies: ReadonlyMap<string, string | undefined>
}

function git(directory: string, args: string[]): string | undefined {
  try {
    const result = spawnSync(["git", ...args], { cwd: directory, stdout: "pipe", stderr: "ignore" })
    return result.exitCode === 0 ? (result.stdout?.toString() ?? "") : undefined
  } catch {
    return undefined
  }
}

function zList(output: string | undefined): string[] {
  return (output ?? "").split("\0").filter(Boolean)
}

function readText(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined
  } catch {
    return undefined
  }
}

/** Test files under `directory` whose content differs from `head`, relative to `directory`. */
function testsChangedSince(directory: string, head: string): string[] {
  return zList(git(directory, ["diff", head, "--name-only", "--no-renames", "--relative", "-z", "--"])).filter((path) => isTestFile(path))
}

/**
 * Files under `directory`, relative with "/" separators, skipping dot entries and node_modules. Walked by hand rather
 * than with Bun.Glob, which the bundle must not need, and without descending into node_modules at all.
 */
function* projectFiles(directory: string, prefix = ""): Generator<string> {
  let entries: Dirent[]
  try {
    entries = readdirSync(prefix ? join(directory, prefix) : directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) yield* projectFiles(directory, path)
    else if (entry.isFile()) yield path
  }
}

function copyAllTests(directory: string): Map<string, string | undefined> {
  const copies = new Map<string, string | undefined>()
  let bytes = 0
  for (const path of projectFiles(directory)) {
    if (!isTestFile(path)) continue
    const text = readText(join(directory, path))
    bytes += text?.length ?? 0
    if (copies.size >= MAX_COPY_FILES || bytes > MAX_COPY_BYTES) {
      log("[test-integrity] too many tests to copy outside git; shell changes to tests are not checked here", { directory })
      return new Map()
    }
    copies.set(path, text)
  }
  return copies
}

export function snapshotTests(directory: string): TestSnapshot {
  const head = git(directory, ["rev-parse", "--verify", "-q", "HEAD"])?.trim() || undefined
  if (head === undefined) return { directory, head, copies: copyAllTests(directory) }
  const copies = new Map<string, string | undefined>()
  for (const path of testsChangedSince(directory, head)) copies.set(path, readText(join(directory, path)))
  return { directory, head, copies }
}

function restore(directory: string, path: string, content: string | undefined): void {
  const full = join(directory, path)
  if (content === undefined) rmSync(full, { force: true })
  else writeFileSync(full, content)
}

/**
 * Puts back every existing test the command changed, unless `allowed(absolutePath)` says the user permitted it.
 * Returns the paths put back, relative to the project.
 */
export function undoTestChanges(snapshot: TestSnapshot, allowed: (path: string) => boolean): string[] {
  const { directory, head, copies } = snapshot
  const undone: string[] = []
  const candidates = head === undefined ? [...copies.keys()] : [...new Set([...copies.keys(), ...testsChangedSince(directory, head)])]
  for (const path of candidates) {
    if (allowed(join(directory, path))) continue
    const before = copies.has(path) ? copies.get(path) : git(directory, ["show", `${head}:./${path}`])
    // A test that was not in HEAD and had no copy is new: new tests are allowed.
    if (before === undefined && !copies.has(path)) continue
    if (readText(join(directory, path)) === before) continue
    restore(directory, path, before)
    undone.push(relative(directory, join(directory, path)))
  }
  return undone
}
