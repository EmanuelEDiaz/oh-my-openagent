/**
 * The plugin under test must load before a run starts (fork incident H57): a build copied away from its node_modules
 * cannot resolve its external `zod`, OpenCode then fails every prompt with "UnknownError", and the bench reported it as
 * a first install that never started. Imported in a child process so the plugin's module code never runs in the bench.
 */
import { dirname } from "node:path"

const CHECK = `
const mod = await import(process.argv[1]);
const plugin = mod.default;
if (typeof plugin?.server !== "function") { console.error("no server function in the default export"); process.exit(2) }
`

export async function assertPluginLoads(pluginEntry: string): Promise<void> {
  const child = Bun.spawn(["bun", "-e", CHECK, pluginEntry], { cwd: dirname(pluginEntry), stdout: "pipe", stderr: "pipe" })
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
  if (code === 0) return
  // The message lines name the cause; the code frame ("123 | ..."), caret line and stack only bury it.
  const lines = stderr.split("\n").map((line) => line.trimEnd()).filter((line) => line.trim() && !/^\s*\d+ \|/.test(line) && !/^\s*\^\s*$/.test(line) && !/^\s+at /.test(line))
  const reason = lines.slice(0, 4).join("\n")
  throw new Error(`plugin ${pluginEntry} does not load (${code === 2 ? "no server function" : `exit ${code}`}):\n${reason}`)
}
