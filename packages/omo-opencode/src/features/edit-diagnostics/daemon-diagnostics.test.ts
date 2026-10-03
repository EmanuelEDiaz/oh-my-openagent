import { describe, expect, test } from "bun:test"

import { parseDaemonDiagnostics } from "./daemon-diagnostics"

describe("LSP daemon diagnostics (fork 0.9a)", () => {
  test("parses the daemon's text lines (1-based line, 0-based column)", () => {
    expect(parseDaemonDiagnostics("error[typescript] (2322) at 1:6: Type 'number' is not assignable to type 'string'.\nNo more")).toEqual([
      { range: { start: { line: 0, character: 6 } }, message: "Type 'number' is not assignable to type 'string'.", severity: 1, code: 2322 },
    ])
  })
})
