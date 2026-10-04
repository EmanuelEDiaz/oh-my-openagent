import { byText } from "./util/compare"

export function sortNames(names: readonly string[]): string[] {
  return [...names].sort(byText)
}

export function groupByInitial(names: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const name of sortNames(names)) {
    const initial = name.charAt(0)
    groups.set(initial, [...(groups.get(initial) ?? []), name])
  }
  return groups
}
