import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

function resolveConfigPath(pathValue: string): string {
  const resolvedPath = resolve(pathValue)
  if (!existsSync(resolvedPath)) return resolvedPath

  try {
    return realpathSync(resolvedPath)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return resolvedPath
  }
}

export function getOpenCodeCliConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const customConfigDir = env["OPENCODE_CONFIG_DIR"]?.trim()
  if (customConfigDir) {
    return resolveConfigPath(customConfigDir)
  }

  // HOME first, like utils' getHomeDirectory: os.homedir() ignores a changed HOME (fork finding H34).
  const home = env["HOME"]?.trim() || env["USERPROFILE"]?.trim() || homedir()
  const xdgConfigDir = env["XDG_CONFIG_HOME"]?.trim() || join(home, ".config")
  return resolveConfigPath(join(xdgConfigDir, "opencode"))
}
