import type { ToolReport } from "./check"

/** One problem, shaped like a doctor issue: what is wrong, what stops working, how to fix it for good. */
export type ToolIssue = {
  readonly title: string
  readonly description: string
  readonly fix: string
  readonly affects: string[]
  readonly severity: "warning"
}

const MARK: Record<ToolReport["status"], string> = { connects: "✓", fails: "✗", missing: "✗" }

export function installCommand(report: ToolReport, platform: NodeJS.Platform = process.platform): string {
  const command = platform === "win32" ? report.tool.install.windows : report.tool.install.linux
  return report.tool.durable ? `${command}\nTo keep it across Node upgrades: ${report.tool.durable}` : command
}

/** `doctor` lines: one per tool, connects / does not connect / not installed. */
export function doctorLines(reports: readonly ToolReport[]): string[] {
  const words: Record<ToolReport["status"], string> = { connects: "connects", fails: "does not connect", missing: "not installed" }
  return reports.map((report) => `${MARK[report.status]} ${report.tool.label}: ${words[report.status]} — ${report.detail}`)
}

export function doctorIssues(reports: readonly ToolReport[], platform: NodeJS.Platform = process.platform): ToolIssue[] {
  return reports
    .filter((report) => report.status !== "connects")
    .map((report) => ({
      title: `${report.tool.label} ${report.status === "missing" ? "is not installed" : "does not connect"}`,
      description: `Without it: ${report.tool.impact}. ${report.detail}`,
      fix: installCommand(report, platform),
      affects: [report.tool.id],
      severity: "warning",
    }))
}

/**
 * The startup notice (a toast, never the model's prompt): only the needed tools that are missing or do not connect,
 * what the user loses, and where to see how to fix it. Undefined when everything works.
 */
export function startupNotice(reports: readonly ToolReport[]): string | undefined {
  const problems = reports.filter((report) => report.status !== "connects" && report.tool.need.kind !== "optional")
  if (problems.length === 0) return undefined
  const lines = problems.map((report) => `• ${report.tool.label} ${report.status === "missing" ? "no está instalado" : "no conecta"}: ${report.tool.impactEs}.`)
  return [...lines, "Ejecuta «oh-my-openagent doctor» para ver cómo instalarlo de forma duradera."].join("\n")
}
