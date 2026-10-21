import { afterAll } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT_KEY = "OMO_TEST_TMP_ROOT"

/**
 * Gives this test process its own temp root and deletes it when the process exits (fork finding H31: a test run left
 * hundreds of folders in /tmp). TMPDIR, TMP and TEMP point at the root, so everything made with `mkdtemp(tmpdir())`
 * lands inside it and goes with it. The root is deleted in a global `afterAll`: `bun test` (1.4.3) fires neither
 * `exit` nor `beforeExit` in a preload. Both preloads call this; the second one in the same process reuses the root. A
 * child test process sees another pid and makes its own root inside its parent's, so it never deletes the parent's.
 */
export function useProcessTempRoot(): string {
  const [pid, existing] = (process.env[ROOT_KEY] ?? "").split("|")
  if (pid === String(process.pid) && existing) return existing
  const root = mkdtempSync(join(tmpdir(), "omo-test-run-"))
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = root
  process.env[ROOT_KEY] = `${process.pid}|${root}`
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  return root
}
