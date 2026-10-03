import { describe, expect, test } from "bun:test"

import { isResumeIntent, pausedWorkGuidance, resumeReminder } from "./intent"

describe("resume intent in plain language (fork 0.8c)", () => {
  test.each([
    "reanuda", "Reanuda lo que estabas haciendo", "continúa lo de antes", "continua donde lo dejaste", "sigue con lo que hacías",
    "retoma la tarea", "vuelve a lo que estabas haciendo", "resume", "continue where you left off", "pick up where we left off",
    "/omo-resume",
  ])("detects %s", (text) => expect(isResumeIntent(text)).toBe(true))

  test.each([
    "continúa con el siguiente test", "resume the meeting notes in a summary please", "sigue estas instrucciones: crea un archivo",
    "para", "olvida eso", "haz un resumen", "reanudar la conexión de la base de datos falla con este error",
  ])("ignores %s", (text) => expect(isResumeIntent(text)).toBe(false))

  test("guidance lists paused work and tells the agent to call resume_task", () => {
    const text = pausedWorkGuidance([{ id: "run_ses_a", reason: "the model stalled 3 times", nextAction: "Continue the plan at: 2. Login" }])
    expect(text).toContain("run_ses_a")
    expect(text).toContain("resume_task")
    expect(pausedWorkGuidance([])).toBeUndefined()
  })

  test("the reminder names the newest paused id, only when there is paused work and the user asks to resume", () => {
    const paused = [{ id: "run_new", reason: "SIGTERM" }, { id: "run_old", reason: "stalled" }]
    expect(resumeReminder("reanuda", paused)).toContain('resume_task({ id: "run_new" })')
    expect(resumeReminder("reanuda", paused)).toContain("run_old")
    expect(resumeReminder("reanuda", [])).toBeUndefined()
    expect(resumeReminder("crea un archivo", paused)).toBeUndefined()
  })
})
