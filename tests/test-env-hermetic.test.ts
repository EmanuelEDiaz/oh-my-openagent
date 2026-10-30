import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"

// Fork finding H34 (21-10-2026): the user's shell exports XDG_CONFIG_HOME=~/.config. The preloads made HOME hermetic
// but kept that variable, so tests read the user's real OpenCode config (omo setup listed their MCP servers) and an
// OAuth storage test wrote fake tokens into ~/.config/opencode/mcp-oauth. CI never sets it, so it never showed there.
// Unsetting is not enough: code then falls back to os.homedir(), which stays the real home under a changed HOME.
const REAL_HOME = homedir()
const CONFIG_VARS = ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "SENPI_CODING_AGENT_DIR", "OMO_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]

describe("hermetic test environment", () => {
  test("#given the preloads ran #then the config, state and Senpi dirs point outside the real home", () => {
    for (const name of ["XDG_CONFIG_HOME", "XDG_STATE_HOME", "SENPI_CODING_AGENT_DIR"]) {
      expect(process.env[name], name).toBeDefined()
      expect(process.env[name]?.startsWith(REAL_HOME), name).toBe(false)
    }
  })

  test("#given the preloads ran #then no inherited variable points into the real home", () => {
    const leaking = CONFIG_VARS.filter((name) => process.env[name]?.startsWith(REAL_HOME))
    expect(leaking).toEqual([])
  })
})
