/** Versioned per-agent report (docs/fork/evals/<agent>.md): a history row per run plus the detail of the last run. */
import type { Summary } from "./score"

export type ReportMeta = { readonly agent: string; readonly date: string; readonly label: string; readonly split: string }

const HISTORY_START = "<!-- history:start -->"
const HISTORY_END = "<!-- history:end -->"
const HISTORY_HEADER = "| Fecha | Etiqueta | Conjunto | Modelos | pass@1 | pass^k | Tokens medios | Fallos infra |\n|---|---|---|---|---|---|---|---|"

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)} %`
}

function previousRows(previous: string | undefined): string[] {
  if (!previous) return []
  const start = previous.indexOf(HISTORY_START)
  const end = previous.indexOf(HISTORY_END)
  if (start === -1 || end === -1) return []
  return previous
    .slice(start + HISTORY_START.length, end)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Fecha") && !line.startsWith("|---"))
}

function modelsOf(row: string): string {
  return row.split("|")[4]?.trim() ?? ""
}

export function renderReport(previous: string | undefined, summary: Summary, meta: ReportMeta): string {
  const models = summary.models.join(", ")
  const rows = [
    ...previousRows(previous),
    `| ${meta.date} | ${meta.label} | ${meta.split} | ${models} | ${percent(summary.passAt1)} | ${percent(summary.passHatK)} | ${Math.round(summary.meanTokens)} | ${summary.infraFailures} |`,
  ]
  const before = rows.at(-2)
  const warning = before !== undefined && modelsOf(before) !== models
    ? `\n> **Aviso:** la última ejecución usó modelos distintos que la anterior (${modelsOf(before)} → ${models}); no son comparables.\n`
    : ""
  const tasks = summary.tasks.map((task) => {
    const failed = Object.entries(task.failedGraders).map(([name, count]) => `${name} ×${count}`).join(", ") || "—"
    return `| ${task.taskId} | ${task.passed}/${task.scored} | ${percent(task.passHatK)} | ${task.infraFailures} | ${failed} |`
  })
  return [
    `# Evaluaciones — ${meta.agent}`,
    "",
    "Generado por `script/fork/bench/run.ts` (plan: `docs/fork/plans/test-bench.md`). Las transcripciones están en",
    "`.omo/evals/` (local, no versionado). Solo son comparables las filas con los mismos modelos y el mismo conjunto.",
    "",
    "## Historial",
    HISTORY_START,
    HISTORY_HEADER,
    ...rows,
    HISTORY_END,
    warning,
    `## Última ejecución — ${meta.date}, ${meta.label}`,
    `- k = ${summary.k}; turnos medios ${summary.meanTurns.toFixed(1)}; tiempo medio ${(summary.meanDurationMs / 1000).toFixed(0)} s.`,
    "",
    "| Tarea | Pasa | pass^k | Fallos infra | Correctores que fallan |",
    "|---|---|---|---|---|",
    ...tasks,
    "",
  ].join("\n")
}
