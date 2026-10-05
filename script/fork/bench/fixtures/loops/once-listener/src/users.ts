import type { EventBus } from "./bus"

export type User = { readonly id: number; readonly name: string }

export function createUserService(bus: EventBus) {
  const users = new Map<number, User>()
  return {
    save(user: User): void {
      users.set(user.id, user)
      bus.emit("user:saved", user)
    },
    get: (id: number) => users.get(id),
  }
}
