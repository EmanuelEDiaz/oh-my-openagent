import { groupByInitial, sortNames } from "./group"

export function renderIndex(names: readonly string[]): string {
  const groups = groupByInitial(names.map((name) => name.trim()).filter(Boolean))
  return sortNames([...groups.keys()])
    .map((initial) => `${initial}: ${(groups.get(initial) ?? []).join(", ")}`)
    .join("\n")
}
