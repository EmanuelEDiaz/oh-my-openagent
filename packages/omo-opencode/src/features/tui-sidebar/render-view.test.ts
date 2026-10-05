import { describe, expect, it } from "bun:test"

import { computeView } from "./compute-view"
import { buildViewNodes, describeView } from "./render-view"
import type { ComputeViewSections } from "./compute-view"
import type { SidebarView } from "./state-types"

const theme = {
  accent: "accent",
  borderSubtle: "border",
  error: "error",
  info: "info",
  success: "success",
  text: "text",
  textMuted: "muted",
  warning: "warning",
}

const activeSections: ComputeViewSections = {
  config: { kind: "invalid", messages: ["agents.sisyphus.model: expected string"] },
  roster: { kind: "empty" },
  agents: { kind: "list", agents: [{ name: "fixer", status: "busy" }] },
  jobs: { kind: "list", jobs: [{ title: "explore repo", status: "running", toolCalls: 3, lastTool: "grep" }] },
  loop: {
    kind: "live",
    goalsDone: 0,
    goalsTotal: 1,
    pass: 1,
    fail: 1,
    pending: 0,
    blocked: 0,
    activeGoal: "g1",
  },
}

describe("tui sidebar renderView", () => {
  it("#given active view #when building nodes #then it renders ULW agents jobs and invalid banner in order", () => {
    // given
    const view = computeView(activeSections)

    // when
    const description = describeView(view)
    const nodes = buildViewNodes(view, theme)

    // then
    expect(description).toContain("config invalid")
    expect(description.indexOf("ULW")).toBeLessThan(description.indexOf("Agents"))
    expect(description.indexOf("Agents")).toBeLessThan(description.indexOf("Jobs"))
    expect(description).toContain("0/1")
    expect(description).toContain("pass 1")
    expect(description).toContain("fail 1")
    expect(description).toContain("fixer")
    expect(description).toContain("explore repo")
    expect(nodes[0]?.kind).toBe("box")
  })

  it("#given a redacted active goal #when describing #then it reports the active goal as private", () => {
    // given
    const view = computeView({
      ...activeSections,
      loop: { ...activeSections.loop, activeGoal: null },
    })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("active private")
    expect(description).not.toContain("active none")
  })

  it("#given broken view #when describing #then it includes config invalid and run doctor", () => {
    // given
    const view = computeView({
      config: { kind: "invalid", messages: ["agents.sisyphus.model: expected string"] },
      roster: { kind: "empty" },
      agents: { kind: "none" },
      jobs: { kind: "none" },
      loop: { kind: "none" },
    })

    // when
    const description = describeView(view)

    // then
    expect(view.kind).toBe("broken")
    expect(description).toContain("config invalid")
    expect(description).toContain("run doctor")
    expect(description).toContain("agents.sisyphus.model")
  })

  it("#given idle roster #when rendering #then it lists configured model rows", () => {
    // given
    const view: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "sisyphus", model: "gpt-5.5" }] },
    }

    // when
    const description = describeView(view)
    const nodes = buildViewNodes(view, theme)

    // then
    expect(description).toContain("sisyphus")
    expect(description).toContain("gpt-5.5")
    expect(nodes[0]?.kind).toBe("box")
  })

  it("#given a network wait #when describing #then it shows one Spanish line before the other sections", () => {
    // given
    const offline = computeView({ ...activeSections, connection: { kind: "offline", attempt: 3, limit: 12, inS: 15 } })
    const provider = computeView({ ...activeSections, connection: { kind: "provider-down", attempt: 2, limit: 12, inS: null } })
    const retrying = computeView({ ...activeSections, connection: { kind: "offline", attempt: 4, limit: null, inS: 7 } })
    const frozen = computeView({ ...activeSections, connection: { kind: "frozen" } })
    const online = computeView({ ...activeSections, connection: { kind: "none" } })

    // then
    expect(describeView(offline)).toContain("Sin conexión · reintento 3/12 en 15s")
    expect(describeView(offline).indexOf("Sin conexión")).toBeLessThan(describeView(offline).indexOf("ULW"))
    expect(describeView(provider)).toContain("Proveedor sin respuesta · reintento 2/12")
    expect(describeView(provider)).not.toContain(" en ")
    expect(describeView(retrying)).toContain("Sin conexión · reintento 4 en 7s")
    expect(describeView(frozen)).toContain("Reanudando tras congelamiento…")
    expect(describeView(online)).not.toContain("conexión")
    expect(JSON.stringify(buildViewNodes(offline, theme))).toContain("Sin conexión · reintento 3/12 en 15s")
  })
})
