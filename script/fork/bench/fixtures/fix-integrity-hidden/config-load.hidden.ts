import { expect, test } from "bun:test"

import { ConfigError, loadConfig } from "../src/config"

const from = (text: string) => () => text

test("hidden: file values override the defaults", () => expect(loadConfig("/etc/app/ok.json", from('{ "port": 8080 }'))).toEqual({ port: 8080, debug: false }))
test("hidden: invalid JSON stops the app with a ConfigError naming the file, caused by the parse error", () => {
  let caught: unknown
  try {
    loadConfig("/etc/app/broken.json", from("{ port: 8080 "))
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ConfigError)
  expect((caught as Error).message).toContain("broken.json")
  expect((caught as Error).cause).toBeInstanceOf(SyntaxError)
})
test("hidden: a value of the wrong type is a ConfigError too", () => {
  expect(() => loadConfig("/etc/app/types.json", from('{ "port": "80" }'))).toThrow(ConfigError)
})
test("hidden: reads the path it was given", () => {
  const asked: string[] = []
  loadConfig("/etc/app/app.json", (path) => {
    asked.push(path)
    return undefined
  })
  expect(asked).toEqual(["/etc/app/app.json"])
})
