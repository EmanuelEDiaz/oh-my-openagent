/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { typeErrorFindings } from "./checks"

const rules = (path: string, before: string, after: string) => typeErrorFindings(path, before, after).map((finding) => finding.rule)

describe("type escapes (TypeScript): only new ones count", () => {
  test.each([
    ["explicit any", "function f(x: number) {}", "function f(x: any) {}"],
    ["as any", "const v = read()", "const v = read() as any"],
    ["any in a generic", "let xs: string[] = []", "let xs: Array<any> = []"],
    ["any array", "let xs: string[] = []", "let xs: any[] = []"],
    ["double assertion", "const u = raw as User", "const u = raw as unknown as User"],
    ["non-null assertion", "const n = map.get(k)", "const n = map.get(k)!.name"],
  ])("%s is blocked", (_name, before, after) => {
    expect(rules("/p/src/a.ts", before, after).length).toBeGreaterThan(0)
  })

  test("an any that was already there is not new", () => {
    expect(rules("/p/src/a.ts", "function f(x: any) {}", "function f(x: any) { return x }")).toEqual([])
  })

  test("moving code with an existing any around is not new", () => {
    expect(rules("/p/src/a.ts", "const a = 1\nfunction f(x: any) {}", "function f(x: any) {}\nconst a = 1")).toEqual([])
  })

  test.each([
    ["unknown alone", "const v: unknown = read()"],
    ["as const", "const k = ['a'] as const"],
    ["satisfies", "const c = { a: 1 } satisfies Config"],
    ["not-equal operator", "if (a != b && c !== d) {}"],
    ["logical not", "if (!ready) return"],
    ["the word any in a string", "log('any value works')"],
    ["the word any in a comment", "// accepts any input"],
    ["an identifier containing any", "const company = anyOf(x)"],
    ["the word any inside a regex literal", "const LOOSE = /:\\s*any\\b|<any>/g"],
    ["a regex after return", "function f() { return /as any/.test(s) }"],
  ])("%s is fine", (_name, after) => {
    expect(rules("/p/src/a.ts", "", after)).toEqual([])
  })

  test("plain JavaScript has no type escapes to check", () => {
    expect(rules("/p/src/a.js", "", "const n = map.get(k)!.name")).toEqual([])
  })
})

describe("swallowed errors", () => {
  test.each([
    ["empty catch", "try { run() } catch (e) {}"],
    ["empty catch without binding", "try { run() } catch {}"],
    ["catch over several lines", "try {\n  run()\n} catch (error) {\n\n}"],
    ["catch returning null", "try { return run() } catch (e) { return null }"],
    ["catch returning an empty array", "try { return run() } catch { return [] }"],
    ["promise catch with an empty arrow", "fetchIt().catch(() => {})"],
    ["promise catch returning undefined", "fetchIt().catch((e) => undefined)"],
    ["a useless comment does not explain anything", "try { run() } catch (e) { // ignore\n}"],
  ])("%s is blocked", (_name, after) => {
    expect(rules("/p/src/a.ts", "", after)).toContain("swallowed-error")
  })

  test("rethrowing without the cause loses the original error", () => {
    expect(rules("/p/src/a.ts", "", "try { run() } catch (e) { throw new Error('run failed') }")).toContain("rethrow-without-cause")
  })

  test.each([
    ["rethrow with cause", "try { run() } catch (e) { throw new Error('run failed', { cause: e }) }"],
    ["rethrow of the same error", "try { run() } catch (e) { log(e); throw e }"],
    ["handled with a fallback and a log", "try { return run() } catch (e) { logger.error('run failed', e); return fallback() }"],
    ["an explained, intentional swallow", "try { rmSync(tmp) } catch {\n  // the temp dir may already be gone; nothing to clean\n}"],
    ["catch with nested blocks that handles the error", "try { run() } catch (e) { if (isRetryable(e)) { retry() } else { throw e } }"],
    ["the word catch inside a string", "const s = 'try { } catch (e) {}'"],
  ])("%s is fine", (_name, after) => {
    expect(rules("/p/src/a.ts", "", after)).toEqual([])
  })

  test("an empty catch that already existed is not new", () => {
    const old = "try { a() } catch {}"
    expect(rules("/p/src/a.ts", old, `${old}\nconst x = 1`)).toEqual([])
  })

  test("Python: bare except with pass", () => {
    expect(rules("/p/app/run.py", "", "try:\n    run()\nexcept:\n    pass\n")).toContain("swallowed-error")
    expect(rules("/p/app/run.py", "", "try:\n    run()\nexcept Exception as e:\n    pass\n")).toContain("swallowed-error")
    expect(rules("/p/app/run.py", "", "try:\n    run()\nexcept Exception as e:\n    log.exception('run failed')\n    raise\n")).toEqual([])
    expect(rules("/p/app/run.py", "", "try:\n    os.remove(p)\nexcept FileNotFoundError:\n    pass  # already removed by the cleanup job\n")).toEqual([])
  })

  test("Go: discarded error", () => {
    expect(rules("/p/cmd/main.go", "", "v, err := run()\n_ = err\n")).toContain("swallowed-error")
    expect(rules("/p/cmd/main.go", "", "if err != nil {\n\treturn nil\n}")).toContain("swallowed-error")
    expect(rules("/p/cmd/main.go", "", "if err != nil {\n\treturn fmt.Errorf(\"run: %w\", err)\n}")).toEqual([])
  })

  test("PHP: empty catch", () => {
    expect(rules("/p/src/Job.php", "", "try { $this->run(); } catch (\\Throwable $e) {}")).toContain("swallowed-error")
  })
})

describe("deleted annotations and loosened configuration", () => {
  test("removing a parameter or return type from the same function is blocked", () => {
    expect(rules("/p/src/a.ts", "export function total(items: Item[]): number {", "export function total(items): number {")).toContain("annotation-removed")
    expect(rules("/p/src/a.ts", "const total = (items: Item[]): number => 0", "const total = (items: Item[]) => 0")).toContain("annotation-removed")
  })

  test("renaming or adding annotations is fine", () => {
    expect(rules("/p/src/a.ts", "function total(items: Item[]): number {", "function total(items: Item[], tax: number): number {")).toEqual([])
  })

  test.each([
    ["tsconfig strict off", "/p/tsconfig.json", '{ "compilerOptions": { "strict": true } }', '{ "compilerOptions": { "strict": false } }'],
    ["tsconfig noImplicitAny off", "/p/tsconfig.base.json", '{ "compilerOptions": {} }', '{ "compilerOptions": { "noImplicitAny": false } }'],
    ["eslint rule switched off", "/p/eslint.config.js", 'rules: { "no-explicit-any": "error" }', 'rules: { "no-explicit-any": "off" }'],
    ["biome rule switched off", "/p/biome.json", '{ "noExplicitAny": "error" }', '{ "noExplicitAny": "off" }'],
    ["mypy strict off", "/p/pyproject.toml", "[tool.mypy]\nstrict = true", "[tool.mypy]\nstrict = false"],
    ["phpstan level lowered", "/p/phpstan.neon", "parameters:\n    level: 8", "parameters:\n    level: 3"],
  ])("%s is blocked", (_name, path, before, after) => {
    expect(rules(path, before, after)).toContain("config-loosened")
  })

  test("tightening the configuration is fine", () => {
    expect(rules("/p/tsconfig.json", '{ "compilerOptions": { "strict": false } }', '{ "compilerOptions": { "strict": true } }')).toEqual([])
  })
})

describe("exempt files", () => {
  test.each(["/p/src/a.test.ts", "/p/src/__tests__/a.ts", "/p/src/types.d.ts", "/p/src/generated/api.ts", "/p/vendor/lib/x.php", "/p/node_modules/x/index.ts", "/p/api/user_pb2.py"])("%s", (path) => {
    expect(rules(path, "", "try { run() } catch {}\nconst v = x as any")).toEqual([])
  })
})

describe("each finding says what to do instead", () => {
  test("the alternative is part of the finding", () => {
    const [anyFinding] = typeErrorFindings("/p/src/a.ts", "", "const v = read() as any")
    expect(anyFinding?.fix).toContain("unknown")
    const [swallow] = typeErrorFindings("/p/src/a.ts", "", "try { run() } catch (e) {}")
    expect(swallow?.fix).toContain("cause")
    expect(swallow?.line).toContain("catch")
  })
})
