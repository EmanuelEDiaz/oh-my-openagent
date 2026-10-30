import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { getOpenCodeCliConfigDir } from "./config-dir"

// Fork finding H34 (21-10-2026): without XDG_CONFIG_HOME the folder came from os.homedir(), which ignores HOME, so a
// test with a hermetic HOME still wrote OAuth tokens into the real ~/.config/opencode. HOME comes first, as in
// utils' getHomeDirectory.
describe("getOpenCodeCliConfigDir", () => {
  test("#given HOME and no XDG_CONFIG_HOME #then the folder is under HOME", () => {
    expect(getOpenCodeCliConfigDir({ HOME: "/tmp/omo-home-probe" })).toBe(join("/tmp/omo-home-probe", ".config", "opencode"))
  })

  test("#given XDG_CONFIG_HOME #then it wins over HOME", () => {
    expect(getOpenCodeCliConfigDir({ HOME: "/tmp/omo-home-probe", XDG_CONFIG_HOME: "/tmp/omo-xdg-probe" })).toBe(join("/tmp/omo-xdg-probe", "opencode"))
  })

  test("#given OPENCODE_CONFIG_DIR #then it wins over everything", () => {
    expect(getOpenCodeCliConfigDir({ HOME: "/tmp/h", XDG_CONFIG_HOME: "/tmp/x", OPENCODE_CONFIG_DIR: "/tmp/omo-custom-probe" })).toBe("/tmp/omo-custom-probe")
  })
})
