/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { IDEAS_MODE_MARKER, ideasModeActive, isExplicitPlanOrder, planWriteRefusal } from "./gate"

const on = (args = "") => `${IDEAS_MODE_MARKER}\n<user-request>${args}</user-request>`

describe("ideas mode is read from the user's own messages (roadmap 0.23, layer 1)", () => {
  test("off by default", () => {
    expect(ideasModeActive(["write me a plan for the login page"])).toBe(false)
  })

  test("/omo-ideas or a message starting with 'idea:' turns it on; '/omo-ideas off' turns it off", () => {
    expect(ideasModeActive([on()])).toBe(true)
    expect(ideasModeActive(["Idea: a sidebar for guards"])).toBe(true)
    expect(ideasModeActive([on(), "more about it", on("off")])).toBe(false)
    expect(ideasModeActive([on("off"), "idea: another one"])).toBe(true)
  })
})

describe("only an explicit order puts an idea in the plan", () => {
  test.each([
    "añádelo al plan",
    "Añade la idea 2 al plan, por favor",
    "agrégalo al plan",
    "mete esto en el plan",
    "inclúyela en el plan",
    "pásalo al plan",
    "add it to the plan",
    "put idea 1 in the plan",
  ])("order: %s", (text) => {
    expect(isExplicitPlanOrder(text)).toBe(true)
  })

  test.each([
    "sí",
    "ok, me gusta",
    "investiga si ya existe",
    "no lo añadas al plan todavía",
    "no la agregues al plan",
    "don't add it to the plan yet",
    "¿lo añadirías al plan?",
    "what would the plan look like?",
  ])("not an order: %s", (text) => {
    expect(isExplicitPlanOrder(text)).toBe(false)
  })
})

describe("plan writes in ideas mode", () => {
  test("blocked without an explicit order, with what to do instead", () => {
    const refusal = planWriteRefusal([on(), "the guards could show in the sidebar", "sí"])
    expect(refusal).toContain("has not asked to add")
    expect(refusal).toContain(".omo/ideas.md")
  })

  test("allowed when the latest user message is the order", () => {
    expect(planWriteRefusal([on(), "the guards could show in the sidebar", "añádelo al plan"])).toBeUndefined()
  })

  test("an earlier order does not cover later turns", () => {
    expect(planWriteRefusal([on(), "añádelo al plan", "and another idea: dark mode"])).toBeDefined()
  })

  test("outside ideas mode the planner works as before", () => {
    expect(planWriteRefusal(["write the plan for the login page"])).toBeUndefined()
  })
})

describe("user texts come from the user's own typing", () => {
  const { userTextsFromMessages } = require("./session-user-texts") as typeof import("./session-user-texts")

  test("oldest first, user messages only, synthetic notes left out", () => {
    const texts = userTextsFromMessages([
      { info: { role: "user", time: { created: 2 } }, parts: [{ type: "text", text: "añádelo al plan", synthetic: true }, { type: "text", text: "sí" }] },
      { info: { role: "assistant", time: { created: 1.5 } }, parts: [{ type: "text", text: "add it to the plan" }] },
      { info: { role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "idea: sidebar" }] },
    ])
    expect(texts).toEqual(["idea: sidebar", "sí"])
    // the injected "añádelo al plan" must not open the gate
    expect(planWriteRefusal(texts)).toBeDefined()
  })

  test("an order followed by a remark after it still counts", () => {
    expect(isExplicitPlanOrder("añádelo al plan, no te olvides de las fuentes")).toBe(true)
  })
})
