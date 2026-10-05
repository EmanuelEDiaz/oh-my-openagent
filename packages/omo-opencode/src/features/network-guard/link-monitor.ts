/**
 * Linux-only network change watch for the network guard (fork roadmap 0.15): `ip -o monitor link address route`
 * (iproute2) prints a line on every link/address/route change, which wakes the probes at once instead of waiting out
 * the backoff. Runs only while a session is offline; Windows, macOS and systems without `ip` rely on the backoff.
 */
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

const IP_PATHS = ["/usr/sbin/ip", "/sbin/ip", "/usr/bin/ip", "/bin/ip"]

export function findIpBinary(platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync): string | undefined {
  if (platform !== "linux") return undefined
  return IP_PATHS.find((path) => exists(path))
}

export function watchLinkChanges(onChange: () => void, log?: (message: string, data?: Record<string, unknown>) => void): { stop(): void } | undefined {
  const ip = findIpBinary()
  if (!ip) return undefined
  try {
    const child = spawn(ip, ["-o", "monitor", "link", "address", "route"], { stdio: ["ignore", "pipe", "ignore"] })
    child.on("error", (error) => log?.("[network-guard] ip monitor failed", { error: String(error) }))
    child.stdout?.on("data", () => onChange())
    // Never keeps the plugin process alive.
    child.unref()
    ;(child.stdout as unknown as { unref?: () => void } | null)?.unref?.()
    return {
      stop(): void {
        if (child.exitCode === null && !child.killed) child.kill()
      },
    }
  } catch (error) {
    log?.("[network-guard] ip monitor unavailable", { error: String(error) })
    return undefined
  }
}
