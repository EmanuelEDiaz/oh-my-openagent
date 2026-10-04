import type { EventBus } from "./bus"
import type { User } from "./users"

export function createAudit(bus: EventBus) {
  const entries: string[] = []
  return {
    entries,
    recordNext(label: string): void {
      bus.once("user:saved", (payload) => {
        const user = payload as User
        entries.push(`${label}:${user.id}`)
      })
    },
  }
}
