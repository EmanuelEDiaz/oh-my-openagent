import type { Task } from "./task"

export function overdue(tasks: readonly Task[], today: string): string[] {
  return tasks
    .filter((task) => task.due !== undefined && task.due < today)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""))
    .map((task) => task.title)
}
