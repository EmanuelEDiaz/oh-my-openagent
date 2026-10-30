/**
 * One object per OpenCode instance, keyed by project folder (fork incidents H13). One OpenCode server can host several
 * project folders, each with its own plugin instance; a module-level "current" lets the newest instance overwrite the
 * others, and an old instance's dispose clear the live one's. A caller that knows its folder gets its own object; one
 * that does not gets the most recent live instance's, which is what a single-folder TUI always had.
 */
export type InstanceRegistry<T> = {
  /** Registers the object of a folder; the returned function removes it (only if it is still that object). */
  register(directory: string, value: T): () => void
  get(directory?: string): T | undefined
  /** Every live instance's object, oldest first. */
  values(): T[]
  size(): number
}

export function createInstanceRegistry<T>(): InstanceRegistry<T> {
  const byDirectory = new Map<string, T>()
  return {
    register(directory, value) {
      // Re-inserting moves the folder to the end, so it becomes the most recent.
      byDirectory.delete(directory)
      byDirectory.set(directory, value)
      return () => {
        if (byDirectory.get(directory) === value) byDirectory.delete(directory)
      }
    },
    get(directory) {
      if (directory !== undefined && byDirectory.has(directory)) return byDirectory.get(directory)
      return [...byDirectory.values()].at(-1)
    },
    values() {
      return [...byDirectory.values()]
    },
    size() {
      return byDirectory.size
    },
  }
}
