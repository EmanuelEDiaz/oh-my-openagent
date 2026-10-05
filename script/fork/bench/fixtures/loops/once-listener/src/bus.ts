export type Listener = (payload: unknown) => void

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>()

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(event, set)
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener)
  }

  once(event: string, listener: Listener): void {
    const wrapper: Listener = (payload) => {
      this.off(event, listener)
      listener(payload)
    }
    this.on(event, wrapper)
  }

  emit(event: string, payload: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(payload)
  }
}
