export function memoize<Args extends unknown[], R>(fn: (...args: Args) => R): (...args: Args) => R {
  const cache = new Map<string, R>()
  return (...args: Args) => {
    const key = String(args[0])
    if (!cache.has(key)) cache.set(key, fn(...args))
    return cache.get(key) as R
  }
}
