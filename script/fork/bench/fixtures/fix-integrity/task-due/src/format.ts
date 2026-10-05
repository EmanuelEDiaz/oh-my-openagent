import type { Task } from "./task"

export function formatTask(task: Task): string {
  return task.due ? `${task.title} — due ${task.due}` : `${task.title} — no due date`
}
