/** Which files are tests, and which module a test exercises (fork roadmap 0.9a). */
import { basename, dirname, extname, join } from "node:path"

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "testdata", "__mocks__", "__snapshots__", "fixtures"])
const TEST_NAME = [
  /\.(test|spec)\.[cm]?[jt]sx?$/i,
  /\.(test|spec)\.(vue|svelte)$/i,
  /^test_.+\.py$/i,
  /.+_test\.py$/i,
  /^conftest\.py$/i,
  /.+_test\.go$/i,
  /.+Test\.php$/,
  /.+_spec\.rb$/i,
  /.+Tests?\.(cs|java|kt)$/,
]

function segments(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean)
}

export function isTestFile(path: string): boolean {
  const parts = segments(path)
  const name = parts.at(-1) ?? ""
  if (TEST_NAME.some((pattern) => pattern.test(name))) return true
  return parts.slice(0, -1).some((part) => TEST_DIRS.has(part.toLowerCase()))
}

/** The stem of the module a test file exercises: `foo.test.ts` → `foo`, `test_foo.py` → `foo`, `FooTest.php` → `Foo`. */
export function moduleStemOf(testPath: string): string | undefined {
  const name = basename(testPath)
  const patterns: RegExp[] = [
    /^(.+)\.(?:test|spec)\.[^.]+$/i,
    /^test_(.+)\.py$/i,
    /^(.+)_test\.(?:py|go)$/i,
    /^(.+)Test\.php$/,
    /^(.+)_spec\.rb$/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(name)
    if (match?.[1]) return match[1]
  }
  return undefined
}

/** Test files that usually exercise a source file, nearest first. Callers check which exist. */
export function siblingTestCandidates(sourcePath: string): string[] {
  const dir = dirname(sourcePath)
  const ext = extname(sourcePath)
  const stem = basename(sourcePath, ext)
  if (!stem) return []
  const parent = dirname(dir)
  if (ext === ".py") return [join(dir, `test_${stem}.py`), join(dir, `${stem}_test.py`), join(parent, "tests", `test_${stem}.py`)]
  if (ext === ".go") return [join(dir, `${stem}_test.go`)]
  if (ext === ".php") return [join(dir, `${stem}Test.php`)]
  return [
    join(dir, `${stem}.test${ext}`),
    join(dir, `${stem}.spec${ext}`),
    join(dir, "__tests__", `${stem}.test${ext}`),
    join(parent, "test", `${stem}.test${ext}`),
    join(parent, "tests", `${stem}.test${ext}`),
  ]
}
