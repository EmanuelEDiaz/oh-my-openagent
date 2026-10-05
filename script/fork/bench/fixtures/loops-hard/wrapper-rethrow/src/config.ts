import { readFileSync } from "node:fs"
import { basename } from "node:path"

import { normalise, type Config } from "./normalise"

export function loadConfig(path: string): Config {
  try {
    const text = readFileSync(path, "utf8")
    return normalise(JSON.parse(text))
  } catch {
    throw new Error(`Invalid JSON in ${basename(path)}`)
  }
}
