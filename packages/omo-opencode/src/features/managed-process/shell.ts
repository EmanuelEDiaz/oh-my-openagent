/**
 * The shell a managed process runs in. Agents write bash-style commands (pipes, &&), so bash is preferred on every
 * platform: system bash on POSIX, Git Bash on Windows; plain sh or cmd only when bash is missing.
 */
export type ShellHost = {
  readonly platform: NodeJS.Platform
  /** Absolute path of bash (Git Bash on Windows), or null when not installed. */
  readonly bash: string | null
  readonly comspec?: string
}

export function shellArgv(command: string, host: ShellHost): string[] {
  if (host.bash) return [host.bash, "-c", command]
  if (host.platform === "win32") return [host.comspec ?? "cmd.exe", "/d", "/s", "/c", command]
  return ["/bin/sh", "-c", command]
}
