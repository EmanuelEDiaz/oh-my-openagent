/**
 * Free search sources for web-researcher (fork roadmap 4.18). Each returns normalised hits; none needs a key, and the
 * optional keys only raise quotas. DuckDuckGo is not used: its robots.txt disallows /html and /lite.
 */
import { spawn } from "../../shared/bun-spawn-shim"

export type SearchHit = {
  readonly url: string
  readonly title: string
  readonly date?: string
  readonly snippet: string
  readonly source: string
}

export type SourceKeys = {
  readonly tavily?: string
  readonly stackexchange?: string
  readonly searxngUrl?: string
}

/** A source whose free quota is spent; it is skipped until the quota resets. */
export class QuotaError extends Error {}

export const USER_AGENT = "oh-my-openagent-web-research/1.0 (+https://github.com/EmanuelEDiaz/oh-my-openagent)"
const TIMEOUT_MS = 15_000

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: { "user-agent": USER_AGENT, accept: "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${new URL(url).host} answered HTTP ${response.status}`)
  return response.json()
}

const NAMED_ENTITIES: Record<string, string> = { quot: '"', apos: "'", amp: "&", lt: "<", gt: ">", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', times: "×" }

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
}

function plain(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()
}

const STOPWORDS = new Set("a an the of to in on for and or but is are was were be been how what why when where which who do does did can could should would i my me we you your it its this that with from by at as not no into about vs versus get got using use redacted".split(" "))

/**
 * Key terms of a query for keyword search engines (GitHub, Wikipedia): identifiers, error codes and rare words first,
 * paths, quotes and filler dropped. GitHub ANDs every word, so long questions return nothing.
 */
export function keywordQuery(query: string, max = 6): string {
  const tokens = query
    .replace(/["'`()[\]{}<>]/g, " ")
    .replace(/(?:[A-Za-z]:)?[\\/][\w.\\/-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[^\w$@-]+|[^\w$-]+$/g, ""))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token.toLowerCase()) && !/^\d+$/.test(token))
  const score = (token: string) => (/^[A-Z]{1,4}\d{3,}$|^E[A-Z]+$/.test(token) ? 4 : 0) + (/[a-z][A-Z]|_|\.|\$|^[A-Z][a-z]+[A-Z]/.test(token) ? 3 : 0) + (/^[A-Z][a-zA-Z]*Error$|Exception$/.test(token) ? 3 : 0) + Math.min(token.length, 12) / 12
  const unique = [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()]
  const keep = new Set(unique.map((token, index) => ({ token, index, s: score(token) })).sort((a, b) => b.s - a.s || a.index - b.index).slice(0, max).map((entry) => entry.token))
  return unique.filter((token) => keep.has(token)).join(" ")
}

/** The error line itself, without paths, line numbers and addresses, for Q&A search. */
export function errorQuery(query: string): string {
  const line = query.split(/\r?\n/).find((candidate) => /error|exception|failed|cannot|panic/i.test(candidate)) ?? query
  return line.replace(/(?:[A-Za-z]:)?[\\/][\w.\\/-]+/g, " ").replace(/:\d+(?::\d+)?/g, " ").replace(/0x[0-9a-f]+/gi, " ").replace(/\s+/g, " ").trim().slice(0, 200)
}

function isoDate(seconds?: number): string | undefined {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString().slice(0, 10) : undefined
}

export async function stackExchange(query: string, keys: SourceKeys, limit = 5): Promise<SearchHit[]> {
  const params = new URLSearchParams({ order: "desc", sort: "relevance", q: query, site: "stackoverflow", pagesize: String(limit) })
  if (keys.stackexchange) params.set("key", keys.stackexchange)
  const data = await getJson(`https://api.stackexchange.com/2.3/search/excerpts?${params}`) as {
    items?: Array<{ item_type: string; question_id: number; answer_id?: number; title: string; excerpt: string; score: number; is_accepted?: boolean; has_accepted_answer?: boolean; last_activity_date?: number }>
  }
  return (data.items ?? []).map((item) => {
    const url = item.item_type === "answer" && item.answer_id ? `https://stackoverflow.com/a/${item.answer_id}` : `https://stackoverflow.com/q/${item.question_id}`
    const badge = item.is_accepted || item.has_accepted_answer ? "accepted answer, " : ""
    return { url, title: plain(item.title), date: isoDate(item.last_activity_date), snippet: `(${badge}score ${item.score}) ${plain(item.excerpt)}`, source: "stackexchange" }
  })
}

async function run(command: string[]): Promise<string> {
  const proc = spawn(command, { stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill("SIGTERM"), TIMEOUT_MS)
  try {
    const [out, code] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), proc.exited])
    if (code !== 0) throw new Error(`${command[0]} exited with ${code}`)
    return out
  } finally {
    clearTimeout(timer)
  }
}

async function ghIssues(query: string, limit: number, repo?: string): Promise<Array<{ title: string; url: string; updatedAt?: string; body?: string; state?: string; repository?: { nameWithOwner?: string } }>> {
  const out = await run(["gh", "search", "issues", query, ...(repo ? ["--repo", repo] : []), "--limit", String(limit), "--sort", repo ? "created" : "comments", "--json", "title,url,updatedAt,body,state,repository"])
  return JSON.parse(out)
}

/** `owner/repo` named in a query (e.g. "github.com/anomalyco/opencode" or "anomalyco/opencode"). */
export function repoIn(query: string): string | undefined {
  const match = /(?:github\.com\/)?\b([A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*)\b/.exec(query)
  const candidate = match?.[1]
  return candidate && !/\.(?:js|ts|py|go|json|md)$/.test(candidate) && !candidate.includes("..") ? candidate.replace(/\.git$/, "") : undefined
}

/** GitHub ANDs every term: try the key terms, then fewer, until something matches. */
export async function githubIssues(query: string, limit = 5): Promise<SearchHit[]> {
  let items: Awaited<ReturnType<typeof ghIssues>> = []
  // Inside the repository the question names: the exact error text first, then key terms.
  const repo = repoIn(query)
  const rest = repo ? query.replace(new RegExp(`(?:github\\.com/)?${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), " ") : query
  const quoted = /"([^"]{12,})"/.exec(rest)?.[1]
  const attempts = [...(quoted ? [`"${quoted}"`] : []), ...[6, 4, 3].map((size) => keywordQuery(rest, size)).filter(Boolean)]
  for (const terms of attempts) {
    items = await ghIssues(terms, limit, repo).catch(() => [])
    if (items.length > 0) break
  }
  return items.map((item) => ({
    url: item.url,
    title: `${item.repository?.nameWithOwner ?? ""} #${item.url.split("/").pop()}: ${item.title}`,
    date: item.updatedAt?.slice(0, 10),
    snippet: `(${item.state ?? "?"}) ${(item.body ?? "").replace(/\s+/g, " ").slice(0, 300)}`,
    source: "github",
  }))
}

/** Exa's public MCP endpoint answers a stateless tools/call; keyless use is limited to ~150 calls a day. */
export async function exa(query: string, limit = 5): Promise<SearchHit[]> {
  const response = await fetch("https://mcp.exa.ai/mcp?tools=web_search_exa", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": USER_AGENT },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search_exa", arguments: { query, numResults: limit } } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (response.status === 429) throw new QuotaError("exa daily keyless quota reached")
  if (!response.ok) throw new Error(`exa answered HTTP ${response.status}`)
  const raw = await response.text()
  const payload = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("") || raw
  const data = JSON.parse(payload) as { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: { message?: string } }
  if (/rate limit|quota|429/i.test(data.error?.message ?? data.result?.content?.[0]?.text ?? "") && (data.error || data.result?.isError)) throw new QuotaError("exa keyless quota reached")
  if (data.error || data.result?.isError) throw new Error(`exa: ${data.error?.message ?? data.result?.content?.[0]?.text ?? "error"}`.slice(0, 200))
  return parseExaText(data.result?.content?.map((block) => block.text ?? "").join("\n") ?? "")
}

export function parseExaText(text: string): SearchHit[] {
  const hits: SearchHit[] = []
  for (const block of text.split(/\n(?=Title: )/)) {
    const url = /^URL: (\S+)/m.exec(block)?.[1]
    if (!url) continue
    const title = /^Title: (.*)$/m.exec(block)?.[1]?.trim() ?? url
    const published = /^Published: (\S+)/m.exec(block)?.[1]
    const body = block.split(/^Highlights:\s*$/m)[1] ?? block.split(/^Text:\s*$/m)[1] ?? ""
    hits.push({ url, title, ...(published && published !== "N/A" ? { date: published.slice(0, 10) } : {}), snippet: body.replace(/\s+/g, " ").trim().slice(0, 400), source: "exa" })
  }
  return hits
}

export async function tavily(query: string, key: string, limit = 5): Promise<SearchHit[]> {
  const data = await getJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: limit }),
  }) as { results?: Array<{ url: string; title: string; content?: string; published_date?: string }> }
  return (data.results ?? []).map((item) => ({ url: item.url, title: item.title, ...(item.published_date ? { date: item.published_date.slice(0, 10) } : {}), snippet: (item.content ?? "").slice(0, 400), source: "tavily" }))
}

export async function searxng(query: string, baseUrl: string, limit = 5): Promise<SearchHit[]> {
  const data = await getJson(`${baseUrl.replace(/\/$/, "")}/search?${new URLSearchParams({ q: query, format: "json" })}`) as {
    results?: Array<{ url: string; title: string; content?: string; publishedDate?: string }>
  }
  return (data.results ?? []).slice(0, limit).map((item) => ({ url: item.url, title: item.title, ...(item.publishedDate ? { date: item.publishedDate.slice(0, 10) } : {}), snippet: (item.content ?? "").slice(0, 400), source: "searxng" }))
}

export async function wikipedia(query: string, limit = 5): Promise<SearchHit[]> {
  const data = await getJson(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: String(limit), format: "json" })}`) as {
    query?: { search?: Array<{ title: string; snippet: string; timestamp?: string }> }
  }
  return (data.query?.search ?? []).map((item) => ({ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`, title: item.title, date: item.timestamp?.slice(0, 10), snippet: plain(item.snippet), source: "wikipedia" }))
}

export async function hackerNews(query: string, limit = 5): Promise<SearchHit[]> {
  const data = await getJson(`https://hn.algolia.com/api/v1/search?${new URLSearchParams({ query, hitsPerPage: String(limit), tags: "story" })}`) as {
    hits?: Array<{ objectID: string; title?: string; url?: string; created_at?: string; points?: number }>
  }
  return (data.hits ?? []).map((item) => ({ url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`, title: item.title ?? "", date: item.created_at?.slice(0, 10), snippet: `${item.points ?? 0} points on Hacker News`, source: "hackernews" }))
}

/** MDN's site search: official web platform docs, no key. */
export async function mdn(query: string, limit = 5): Promise<SearchHit[]> {
  const data = await getJson(`https://developer.mozilla.org/api/v1/search?${new URLSearchParams({ q: query, locale: "en-US", size: String(limit) })}`) as {
    documents?: Array<{ mdn_url: string; title: string; summary?: string }>
  }
  return (data.documents ?? []).map((doc) => ({ url: `https://developer.mozilla.org${doc.mdn_url}`, title: doc.title, snippet: plain(doc.summary ?? ""), source: "mdn" }))
}

export type Ecosystem = "npm" | "PyPI" | "node" | "github"

export type RegistryInfo = {
  readonly ecosystem: Ecosystem
  readonly name: string
  readonly latest?: string
  readonly publishedAt?: string
  readonly url: string
  readonly advisories: ReadonlyArray<{ id: string; summary: string; url: string; modified?: string }>
  /** Extra exact facts (e.g. the Node.js codename, the newest non-LTS release). */
  readonly notes?: string
}

export async function registryLookup(ecosystem: Ecosystem, name: string): Promise<RegistryInfo> {
  if (ecosystem === "node") {
    // The official release index: newest first, LTS lines named.
    const list = await getJson("https://nodejs.org/dist/index.json") as Array<{ version: string; date: string; lts: string | false }>
    const lts = list.find((entry) => entry.lts)
    const current = list[0]
    return {
      ecosystem, name: "node", url: "https://nodejs.org/dist/index.json", advisories: [],
      ...(lts ? { latest: lts.version.replace(/^v/, ""), publishedAt: lts.date } : {}),
      notes: `newest LTS: ${lts ? `${lts.version} "${lts.lts}" (${lts.date})` : "none"}; newest release overall: ${current ? `${current.version} (${current.date})` : "unknown"}`,
    }
  }
  if (ecosystem === "github") {
    const release = JSON.parse(await run(["gh", "api", `repos/${name}/releases/latest`]).catch(async () => JSON.stringify(await getJson(`https://api.github.com/repos/${name}/releases/latest`)))) as { tag_name?: string; published_at?: string; html_url?: string; name?: string }
    return {
      ecosystem, name, advisories: [], url: release.html_url ?? `https://github.com/${name}/releases`,
      ...(release.tag_name ? { latest: release.tag_name } : {}),
      ...(release.published_at ? { publishedAt: release.published_at.slice(0, 10) } : {}),
      ...(release.name ? { notes: `release name: ${release.name}` } : {}),
    }
  }
  let latest: string | undefined
  let publishedAt: string | undefined
  let url: string
  if (ecosystem === "npm") {
    const data = await getJson(`https://registry.npmjs.org/${name.replace("/", "%2F")}`) as { "dist-tags"?: { latest?: string }; time?: Record<string, string> }
    latest = data["dist-tags"]?.latest
    publishedAt = latest ? data.time?.[latest]?.slice(0, 10) : undefined
    url = `https://www.npmjs.com/package/${name}`
  } else {
    const data = await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`) as { info?: { version?: string }; releases?: Record<string, Array<{ upload_time?: string }>> }
    latest = data.info?.version
    publishedAt = latest ? data.releases?.[latest]?.[0]?.upload_time?.slice(0, 10) : undefined
    url = `https://pypi.org/project/${name}/`
  }
  const osv = await getJson("https://api.osv.dev/v1/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ package: { name, ecosystem }, ...(latest ? { version: latest } : {}) }),
  }).catch(() => ({})) as { vulns?: Array<{ id: string; summary?: string; modified?: string }> }
  const advisories = (osv.vulns ?? []).slice(0, 10).map((vuln) => ({ id: vuln.id, summary: vuln.summary ?? "", url: `https://osv.dev/vulnerability/${vuln.id}`, ...(vuln.modified ? { modified: vuln.modified.slice(0, 10) } : {}) }))
  return { ecosystem, name, ...(latest ? { latest } : {}), ...(publishedAt ? { publishedAt } : {}), url, advisories }
}

/** A Stack Overflow question read through the API: the question, then the accepted and best-voted answers. */
export async function stackOverflowThread(url: string, keys: SourceKeys): Promise<string[] | undefined> {
  const match = /stackoverflow\.com\/(?:q|questions|a)\/(\d+)/.exec(url)
  if (!match) return undefined
  const isAnswer = /stackoverflow\.com\/a\//.test(url)
  const common = { site: "stackoverflow", filter: "withbody", ...(keys.stackexchange ? { key: keys.stackexchange } : {}) }
  let questionId = match[1] as string
  if (isAnswer) {
    const answer = await getJson(`https://api.stackexchange.com/2.3/answers/${questionId}?${new URLSearchParams(common)}`) as { items?: Array<{ question_id: number }> }
    questionId = String(answer.items?.[0]?.question_id ?? questionId)
  }
  const [question, answers] = await Promise.all([
    getJson(`https://api.stackexchange.com/2.3/questions/${questionId}?${new URLSearchParams(common)}`) as Promise<{ items?: Array<{ title: string; body: string }> }>,
    getJson(`https://api.stackexchange.com/2.3/questions/${questionId}/answers?${new URLSearchParams({ ...common, order: "desc", sort: "votes", pagesize: "4" })}`) as Promise<{ items?: Array<{ body: string; score: number; is_accepted: boolean; last_edit_date?: number; creation_date?: number }> }>,
  ])
  const q = question.items?.[0]
  if (!q) return undefined
  const ordered = [...(answers.items ?? [])].sort((a, b) => Number(b.is_accepted) - Number(a.is_accepted) || b.score - a.score).slice(0, 3)
  return [
    `Question: ${plain(q.title)}\n${bodyText(q.body).slice(0, 1200)}`,
    ...ordered.map((a) => `${a.is_accepted ? "Accepted answer" : "Answer"} (score ${a.score}, ${isoDate(a.last_edit_date ?? a.creation_date) ?? "undated"}):\n${bodyText(a.body).slice(0, 1500)}`),
  ]
}

/** Stack Exchange bodies are HTML; keep code blocks readable. */
function bodyText(html: string): string {
  return decodeEntities(html.replace(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g, (_, code: string) => `\n\`\`\`\n${code}\n\`\`\`\n`).replace(/<code>([\s\S]*?)<\/code>/g, "`$1`").replace(/<(?:br|\/p|\/li|\/h\d)[^>]*>/g, "\n").replace(/<[^>]+>/g, "")).replace(/\n{3,}/g, "\n\n").trim()
}

/** A GitHub issue or PR read with gh: the opening post and the comments. */
export async function githubThread(url: string): Promise<string[] | undefined> {
  const match = /github\.com\/([\w.-]+\/[\w.-]+)\/(issues|pull)\/(\d+)/.exec(url)
  if (!match) return undefined
  const kind = match[2] === "pull" ? "pr" : "issue"
  const out = await run(["gh", kind, "view", match[3] as string, "-R", match[1] as string, "--json", "title,body,state,comments"])
  const data = JSON.parse(out) as { title: string; body?: string; state?: string; comments?: Array<{ body: string; createdAt?: string; reactionGroups?: Array<{ users?: { totalCount?: number } }> }> }
  const comments = (data.comments ?? [])
    .map((comment) => ({ ...comment, votes: (comment.reactionGroups ?? []).reduce((sum, group) => sum + (group.users?.totalCount ?? 0), 0) }))
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 4)
  return [
    `${match[2] === "pull" ? "PR" : "Issue"} (${data.state ?? "?"}): ${data.title}\n${(data.body ?? "").slice(0, 1500)}`,
    ...comments.map((comment) => `Comment (${comment.createdAt?.slice(0, 10) ?? "undated"}, ${comment.votes} reactions):\n${comment.body.slice(0, 1200)}`),
  ]
}
