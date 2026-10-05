export interface Task {
  readonly id: number
  readonly title: string
  /** `YYYY-MM-DD`, absent when the task has no deadline. */
  readonly dueDate?: string
}

type ApiTask = { readonly id: number; readonly title: string; readonly due?: string | null }

export function parseTasks(json: string): Task[] {
  const raw = JSON.parse(json) as ApiTask[]
  return raw.map((item) => (item.due ? { id: item.id, title: item.title, dueDate: item.due } : { id: item.id, title: item.title }))
}
