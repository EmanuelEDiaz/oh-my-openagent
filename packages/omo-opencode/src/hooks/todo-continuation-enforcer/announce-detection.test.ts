/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { announcedNextStep } from "./announce-detection"

const assistant = (text: string, withTool = false) => ({
  info: { role: "assistant" },
  parts: [{ type: "text", text }, ...(withTool ? [{ type: "tool", tool: "bash" }] : [])],
})
const user = (text: string) => ({ info: { role: "user" }, parts: [{ type: "text", text }] })

// Fork incident H58: on the real inventory task Sisyphus ended a turn announcing its next step and stopped.
describe("announcedNextStep (fork incident H58)", () => {
  it.each([
    ["the inventory case", "Los resultados apuntan a desajustes esquema↔entidad. Voy a verificarlo con precisión leyendo entidades, DDL y adaptadores."],
    ["Spanish 'ahora'", "Ya tengo el diagnóstico. Ahora reviso los adaptadores y corrijo el mapeo."],
    ["English", "Found the mismatch in the schema. I'll now update the entity mapping."],
    ["English 'let me'", "The migration is missing a column. Let me fix the migration next."],
  ])("true for %s", (_name, text) => {
    expect(announcedNextStep([user("arregla las ventas"), assistant(text)])).toBe(true)
  })

  it.each([
    ["a turn that also used a tool", assistant("Voy a verificarlo leyendo las entidades.", true)],
    ["a question to the user", assistant("Puedo corregir la migración o la entidad. ¿Cuál prefieres que cambie?")],
    ["a finished turn", assistant("Listo: las ventas ya se guardan y los tests pasan. Voy a dejar el resumen aquí.")],
    ["an English finished turn", assistant("Done. All tests pass now.")],
    ["a plain report", assistant("El error está en la columna adjustment_type de la migración V3.")],
  ])("false for %s", (_name, message) => {
    expect(announcedNextStep([user("arregla las ventas"), message])).toBe(false)
  })

  it("false when the last message is the user's", () => {
    expect(announcedNextStep([assistant("Voy a revisarlo."), user("vale")])).toBe(false)
  })
})
