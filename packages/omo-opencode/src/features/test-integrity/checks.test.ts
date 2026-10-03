import { describe, expect, test } from "bun:test"

import { lineDiff } from "./change"
import { blockingFindings } from "./checks"
import { isTestFile, moduleStemOf } from "./test-files"

const change = (path: string, removed: string[], added: string[]) => ({ path, kind: "update" as const, removed, added, exact: true })

describe("test-integrity checks (fork 0.9a)", () => {
  test("recognises tests across languages", () => {
    for (const path of ["a/b.test.ts", "a/b.spec.jsx", "tests/test_x.py", "pkg/x_test.go", "tests/Feature/UserTest.php", "src/__tests__/x.ts", "conftest.py"]) {
      expect(isTestFile(path)).toBe(true)
    }
    for (const path of ["src/latest.ts", "src/contest.py", "src/testing-utils.ts"]) expect(isTestFile(path)).toBe(false)
    expect(moduleStemOf("src/sum.test.ts")).toBe("sum")
    expect(moduleStemOf("tests/test_parser.py")).toBe("parser")
  })

  test("blocks skips in Python, Go and PHP", () => {
    expect(blockingFindings(change("tests/test_x.py", [], ["@pytest.mark.skip(reason='flaky')"]))[0]?.rule).toBe("skip")
    expect(blockingFindings(change("x_test.go", [], ["\tt.Skip(\"later\")"]))[0]?.rule).toBe("skip")
    expect(blockingFindings(change("tests/UserTest.php", [], ["$this->markTestSkipped('x');"]))[0]?.rule).toBe("skip")
  })

  test("moving lines is not removing assertions; commented-out assertions count as removed", () => {
    const moved = lineDiff("a\nexpect(x).toBe(1)\nb", "expect(x).toBe(1)\na\nb")
    expect(moved).toEqual({ added: [], removed: [] })
    expect(blockingFindings(change("a.test.ts", ["  expect(x).toBe(1)"], ["  // expect(x).toBe(1)"]))[0]?.rule).toBe("assertions")
  })

  test("suppressions are blocked in any file; removing one is fine", () => {
    expect(blockingFindings(change("src/a.py", [], ["x = f()  # type: ignore"]))[0]?.rule).toBe("suppression")
    expect(blockingFindings(change("src/a.ts", ["// @ts-ignore"], []))).toEqual([])
  })
})
