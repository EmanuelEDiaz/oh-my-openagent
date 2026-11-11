/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { IDEAS_MODE_MARKER, ideasModeActive } from "../ideas-mode/gate"
import { loadBuiltinCommands } from "./commands"

// Fork roadmap 0.23: /omo-ideas opens the brainstorming mode with Prometheus.
describe("/omo-ideas", () => {
  test("runs with Prometheus and its expanded text switches ideas mode on, or off with 'off'", () => {
    const command = loadBuiltinCommands()["omo-ideas"]
    expect(command?.agent).toBe("prometheus")
    const expand = (args: string) => String(command?.template).replace("$ARGUMENTS", args)
    expect(expand("")).toContain(IDEAS_MODE_MARKER)
    expect(ideasModeActive([expand("a sidebar for guards")])).toBe(true)
    expect(ideasModeActive([expand(""), expand("off")])).toBe(false)
  })

  test("the instruction is short (rule 16: short prompt, details on demand)", () => {
    expect(String(loadBuiltinCommands()["omo-ideas"]?.template).length).toBeLessThan(1500)
  })
})
