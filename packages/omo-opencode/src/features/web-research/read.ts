/**
 * Reads a page for web-researcher (fork roadmap 4.18): Q&A threads and issues through their APIs, other pages by local
 * download and text extraction, and the Jina reader only for pages that need JavaScript. Returns the passages most
 * relevant to the question, ranked with BM25.
 */
import { githubThread, stackOverflowThread, USER_AGENT, type SourceKeys } from "./sources"

const TIMEOUT_MS = 20_000
const MAX_BYTES = 3_000_000
const CHUNK_CHARS = 1500
/** Below this much text a page probably renders with JavaScript. */
const THIN_PAGE_CHARS = 600

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre|\/blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
}

const CHROME = /^(?:sign (?:up|in)|log ?in|create (?:a )?(?:free )?(?:account|workspace)|cookie|accept all|subscribe|share|follow us|skip to (?:main )?content|menu|search|home|privacy policy|terms of (?:service|use)|ask question|save this|show activity|this question (?:shows|does not)|collectives|learn more|all rights reserved|viewed \d|asked \d|modified)\b/i

/** Drops navigation and page chrome: link-only lines, short menu labels, cookie and sign-up banners. */
export function stripChrome(text: string): string {
  const linkOnly = /^(?:\s*(?:[-*•|]|\d+\.)?\s*\[[^\]]*\]\([^)]*\)\s*[|·•]?\s*)+$/
  return text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed) return true
      if (linkOnly.test(trimmed) || CHROME.test(trimmed.replace(/^[#>*\-\s]+/, ""))) return false
      const withoutLinks = trimmed.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      return !(withoutLinks.split(/\s+/).length <= 3 && !/[.:;!?`{}()=]/.test(withoutLinks) && !/^#/.test(trimmed))
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
}

export function chunk(text: string, size = CHUNK_CHARS): string[] {
  const chunks: string[] = []
  let current = ""
  for (const paragraph of text.split(/\n\n+/)) {
    if (current && current.length + paragraph.length > size) {
      chunks.push(current.trim())
      current = ""
    }
    if (paragraph.length > size) {
      for (let i = 0; i < paragraph.length; i += size) chunks.push(paragraph.slice(i, i + size).trim())
    } else {
      current += `${paragraph}\n\n`
    }
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

function terms(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_.$-]{2,}/gu) ?? []
}

/** Okapi BM25 (k1 = 1.2, b = 0.75) of each chunk against the question; returns chunk indexes, best first. */
export function rankChunks(question: string, chunks: readonly string[]): number[] {
  const queryTerms = [...new Set(terms(question))]
  const docs = chunks.map(terms)
  const avg = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length)
  const df = new Map<string, number>()
  for (const doc of docs) for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1)
  const scores = docs.map((doc) => {
    const tf = new Map<string, number>()
    for (const term of doc) tf.set(term, (tf.get(term) ?? 0) + 1)
    let score = 0
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0
      if (!f) continue
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5))
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (doc.length / Math.max(1, avg)))))
    }
    return score
  })
  return scores.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.index)
}

async function fetchLocal(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const type = response.headers.get("content-type") ?? ""
  if (!/text|json|xml|html/.test(type)) throw new Error(`not a text page (${type || "unknown type"})`)
  const body = (await response.text()).slice(0, MAX_BYTES)
  return /html/.test(type) ? htmlToText(body) : body
}

async function fetchJina(url: string, key?: string): Promise<string> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: { "user-agent": USER_AGENT, accept: "text/plain", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Jina reader HTTP ${response.status}`)
  return (await response.text()).slice(0, MAX_BYTES)
}

export async function readPage(
  url: string,
  question: string,
  options: { jinaKey?: string; passages?: number; keys?: SourceKeys } = {},
): Promise<{ text: string; via: "local" | "jina" | "api"; passages: string[] }> {
  // Q&A threads and issues read best through their APIs: the answers, not the page around them.
  const thread = (await stackOverflowThread(url, options.keys ?? {}).catch(() => undefined)) ?? (await githubThread(url).catch(() => undefined))
  if (thread && thread.length > 0) return { text: thread.join("\n\n"), via: "api", passages: thread.slice(0, options.passages ?? 4) }
  let text = ""
  let via: "local" | "jina" = "local"
  let localError: unknown
  try {
    text = await fetchLocal(url)
  } catch (error) {
    localError = error
  }
  if (stripChrome(text).length < THIN_PAGE_CHARS) {
    try {
      const rendered = await fetchJina(url, options.jinaKey)
      if (rendered.length > text.length) {
        text = rendered
        via = "jina"
      }
    } catch (error) {
      if (!text) throw new Error(`could not read the page: ${String(localError ?? error)}`)
    }
  }
  const chunks = chunk(stripChrome(text))
  const order = rankChunks(question, chunks).slice(0, options.passages ?? 3)
  return { text, via, passages: order.sort((a, b) => a - b).map((index) => chunks[index] ?? "") }
}
