/**
 * Keyless search must be good on its own (user, 03-10-2026): every free source is asked in parallel and the lists are
 * merged with reciprocal rank fusion, weighted by source and by how authoritative the site is (fork roadmap 4.18).
 */
import type { SearchHit } from "./sources"

const RRF_K = 60

/** Official docs, specs, Q&A and trackers rank up; content farms and SEO aggregators rank down. */
const AUTHORITATIVE = [
  /(^|\.)developer\.mozilla\.org$/, /(^|\.)github\.com$/, /(^|\.)stackoverflow\.com$/, /(^|\.)stackexchange\.com$/, /(^|\.)wikipedia\.org$/,
  /(^|\.)python\.org$/, /(^|\.)nodejs\.org$/, /(^|\.)bun\.(sh|com)$/, /(^|\.)go\.dev$/, /(^|\.)rust-lang\.org$/, /(^|\.)php\.net$/,
  /(^|\.)laravel\.com$/, /(^|\.)nextjs\.org$/, /(^|\.)nuxt\.com$/, /(^|\.)typescriptlang\.org$/, /(^|\.)npmjs\.com$/, /(^|\.)pypi\.org$/,
  /(^|\.)osv\.dev$/, /(^|\.)nvd\.nist\.gov$/, /(^|\.)opencode\.ai$/, /(^|\.)w3\.org$/, /(^|\.)ietf\.org$/, /(^|\.)readthedocs\.io$/,
]
const LOW_QUALITY = [
  /(^|\.)geeksforgeeks\.org$/, /(^|\.)w3schools\.com$/, /(^|\.)tutorialspoint\.com$/, /(^|\.)javatpoint\.com$/, /(^|\.)quora\.com$/,
  /(^|\.)pinterest\./, /(^|\.)codegrepper\.com$/, /(^|\.)programiz\.com$/, /(^|\.)coderanch\.com$/, /(^|\.)techcrunch\.com$/,
]

export const SOURCE_WEIGHT: Record<string, number> = {
  tavily: 1.2, searxng: 1.2, exa: 1.1, stackexchange: 1.1, github: 1, mdn: 1.1, wikipedia: 0.9, hackernews: 0.6, registry: 1.3, osv: 1.3,
}

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    for (const param of [...parsed.searchParams.keys()]) if (/^utm_|^ref$|^source$/.test(param)) parsed.searchParams.delete(param)
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}${parsed.search}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function authority(url: string): number {
  let host = ""
  try {
    host = new URL(url).host.replace(/^www\./, "")
  } catch {
    return 1
  }
  if (AUTHORITATIVE.some((pattern) => pattern.test(host)) || /^docs\./.test(host) || /\/docs?\//.test(url)) return 1.3
  if (LOW_QUALITY.some((pattern) => pattern.test(host))) return 0.6
  return 1
}

/** How well a result's title and snippet match the query: an exact error line in the title ranks highest. */
export function relevance(query: string, hit: SearchHit): number {
  const norm = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const q = norm(query)
  const title = norm(hit.title)
  if (q.length > 12 && (title.includes(q) || q.includes(title) && title.length > 12)) return 1.6
  const terms = [...new Set(q.split(" ").filter((term) => term.length > 2))]
  if (terms.length === 0) return 1
  const haystack = `${title} ${norm(hit.snippet)}`
  const covered = terms.filter((term) => haystack.includes(term)).length / terms.length
  const inTitle = terms.filter((term) => title.includes(term)).length / terms.length
  return 0.7 + 0.5 * covered + 0.3 * inTitle
}

/** Merge ranked lists from several sources; duplicates add up, so a page several engines agree on rises. */
export function fuse(lists: ReadonlyArray<readonly SearchHit[]>, limit = 5, query?: string): SearchHit[] {
  const scored = new Map<string, { hit: SearchHit; score: number }>()
  for (const list of lists) {
    list.forEach((hit, rank) => {
      const key = canonicalUrl(hit.url)
      const accepted = /accepted answer/.test(hit.snippet) ? 1.2 : 1
      const score = ((SOURCE_WEIGHT[hit.source] ?? 1) * accepted) / (RRF_K + rank + 1)
      const existing = scored.get(key)
      if (existing) {
        existing.score += score
        if (!existing.hit.date && hit.date) existing.hit = { ...existing.hit, date: hit.date }
        if (hit.snippet.length > existing.hit.snippet.length) existing.hit = { ...existing.hit, snippet: hit.snippet }
      } else {
        scored.set(key, { hit, score })
      }
    })
  }
  return [...scored.values()]
    .map((entry) => ({ ...entry, score: entry.score * authority(entry.hit.url) * (query ? relevance(query, entry.hit) : 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.hit)
}
