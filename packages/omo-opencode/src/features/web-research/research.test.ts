import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createSearchCache } from "./cache"
import { authority, fuse, relevance } from "./fusion"

import { chunk, htmlToText, rankChunks, stripChrome } from "./read"
import { createWebResearch, DEFAULT_SOURCES, type Sources } from "./research"
import { decodeEntities, errorQuery, keywordQuery, parseExaText, repoIn, type SearchHit } from "./sources"

const cacheRoot = mkdtempSync(join(tmpdir(), "web-research-cache-"))
afterAll(() => rmSync(cacheRoot, { recursive: true, force: true }))
let cacheCount = 0
const freshCache = () => createSearchCache(join(cacheRoot, String(cacheCount++)))

const hit = (url: string, snippet = "snippet", source = "exa"): SearchHit => ({ url, title: `title ${url}`, snippet, source })

function fakeSources(overrides: Partial<Sources> = {}): Sources & { calls: string[] } {
  const calls: string[] = []
  return {
    ...DEFAULT_SOURCES,
    calls,
    stackexchange: async (q) => { calls.push(`se:${q}`); return [hit("https://stackoverflow.com/a/1", "(accepted answer, score 9) use --isolate", "stackexchange")] },
    github: async (q) => { calls.push(`gh:${q}`); return [hit("https://github.com/o/r/issues/2", "(closed) fixed in 1.2", "github")] },
    exa: async (q) => { calls.push(`exa:${q}`); return [hit("https://example.com/a"), hit("https://example.com/b")] },
    wikipedia: async (q) => { calls.push(`wiki:${q}`); return [] },
    hackernews: async (q) => { calls.push(`hn:${q}`); return [] },
    mdn: async (q) => { calls.push(`mdn:${q}`); return [] },
    read: async (url) => ({ text: "", via: "local", passages: [`Page ${url}. The flag --isolate runs each test file in its own process.`] }),
    isLive: async () => true,
    ...overrides,
  }
}

const config = { maxSearches: 3, maxReads: 2, keys: {} }

describe("web research loop (fork 4.18)", () => {
  test("error-like queries ask Exa, Stack Exchange (the bare error line) and GitHub in parallel; results are fused, untrusted and numbered", async () => {
    const sources = fakeSources()
    const research = createWebResearch(config, sources, freshCache())
    const out = await research.search("s", "TypeError: x is undefined at /home/me/app/src/a.ts:12:3")
    expect(sources.calls.sort()).toEqual(["exa:TypeError: x is undefined at /home/me/app/src/a.ts:12:3", "gh:TypeError: x is undefined at /home/me/app/src/a.ts:12:3", "se:TypeError: x is undefined at"])
    expect(out).toContain("<untrusted_web_content")
    expect(out).toMatch(/\[r1\] title https:\/\/stackoverflow\.com\/a\/1/)
    expect(out).toContain("1/3 searches")
  })

  test("general questions ask Exa, Wikipedia and Hacker News; secrets are stripped; the cache answers repeats", async () => {
    const sources = fakeSources()
    const cache = freshCache()
    const research = createWebResearch(config, sources, cache)
    await research.search("s", "who painted the Mona Lisa sk-abcdefghijklmnopqrstuvwxyz")
    expect(sources.calls.sort()).toEqual(["exa:who painted the Mona Lisa [redacted]", "hn:painted Mona Lisa", "wiki:painted Mona Lisa"])
    const again = createWebResearch(config, sources, cache)
    await again.search("t", "who painted the Mona Lisa sk-abcdefghijklmnopqrstuvwxyz")
    expect(sources.calls.length).toBe(3)
  })

  test("a spent quota is skipped until it resets; other sources carry on", async () => {
    const { QuotaError } = await import("./sources")
    let exaCalls = 0
    const sources = fakeSources({ exa: async () => { exaCalls++; throw new QuotaError("exa keyless quota reached") } })
    const research = createWebResearch({ ...config, maxSearches: 5 }, sources, freshCache())
    const first = await research.search("s", "TypeError: boom")
    expect(first).toContain("exa unavailable")
    expect(first).toContain("stackoverflow.com")
    await research.search("s", "TypeError: other boom")
    expect(exaCalls).toBe(1)
  })

  test("only URLs from its own results can be read; the budget forces an answer", async () => {
    const research = createWebResearch(config, fakeSources(), freshCache())
    await research.search("s", "what is bun")
    expect(await research.read("s", "https://evil.example/x")).toContain("Refused")
    expect(await research.read("s", "r1")).toContain("[r1.p1]")
    await research.read("s", "r2")
    expect(await research.read("s", "r1")).toContain("Answer NOW")
    await research.search("s", "a")
    await research.search("s", "b")
    expect(await research.search("s", "c")).toContain("Search budget is spent")
  })

  test("two searches with nothing new ask for a reformulation", async () => {
    const research = createWebResearch({ ...config, maxSearches: 5 }, fakeSources(), freshCache())
    await research.search("s", "x")
    await research.search("s", "y")
    expect(await research.search("s", "z")).toContain("reformulate")
  })

  test("answers: invented URLs and non-verbatim quotes are rejected once, then marked unverified", async () => {
    const research = createWebResearch(config, fakeSources(), freshCache())
    const found = await research.search("s", "bun isolate")
    const firstUrl = /\[r1\] .*? — (\S+)/.exec(found)?.[1] ?? ""
    await research.read("s", "r1")
    const bad = { answer: "Use --isolate", confidence: "high" as const, claims: [
      { text: "isolate runs files apart", url: firstUrl, quote: "runs each test file in its own process" },
      { text: "made up", url: "https://evil.example/", quote: "anything" },
    ] }
    const first = await research.answer("s", bad)
    expect(first).toContain("REJECTED")
    expect(first).toContain("did not come from your searches")
    const second = await research.answer("s", bad)
    expect(second).toContain("ACCEPTED")
    expect(second).toContain("made up **[unverified]**")
    expect(second).toContain("1/2 claims verified")
    expect(research.verdict("s")).toBe("answered")
    expect(await research.search("s", "more")).toContain("already submitted")
  })

  test("a quote from a page never read and a dead link are not accepted; not_found needs no claims", async () => {
    const research = createWebResearch(config, fakeSources({ isLive: async () => false }), freshCache())
    await research.search("s", "q")
    const out = await research.answer("s", { answer: "x", confidence: "low", claims: [{ text: "t", url: "https://example.com/b", quote: "snippet" }] })
    expect(out).toContain("does not respond")
    const other = createWebResearch(config, fakeSources(), freshCache())
    expect(await other.answer("t", { answer: "No reliable source found", confidence: "not_found", claims: [] })).toContain("ACCEPTED")
  })

  test("registry lookups add the package page and advisories to the citable results", async () => {
    const research = createWebResearch(config, fakeSources({
      registry: async (ecosystem, name) => ({ ecosystem, name, latest: "4.2.0", publishedAt: "2026-09-01", url: `https://www.npmjs.com/package/${name}`, advisories: [{ id: "GHSA-x", summary: "prototype pollution", url: "https://osv.dev/vulnerability/GHSA-x" }] }),
    }), freshCache())
    const out = await research.registry("s", "npm", "lodash")
    expect(out).toContain("latest 4.2.0, published 2026-09-01")
    expect(out).toContain("1 known advisories")
    const answer = await research.answer("s", { answer: "4.2.0", confidence: "high", claims: [{ text: "latest is 4.2.0", url: "https://www.npmjs.com/package/lodash", quote: "latest 4.2.0" }] })
    expect(answer).toContain("1/1 claims verified")
  })
})

describe("query shaping and fusion", () => {
  test("keyword queries keep identifiers and error names, drop filler and paths", () => {
    expect(keywordQuery("why does bun test mock.module leak between files in /home/me/x.ts")).toBe("bun test mock.module leak between files")
    expect(keywordQuery("How do I fix TS2339 Property foo does not exist", 3)).toContain("TS2339")
    expect(errorQuery("at foo (/a/b.ts:1:2)\nTypeError: x is not a function at /src/c.ts:4:5")).toBe("TypeError: x is not a function at")
    expect(decodeEntities("&#215; a &hellip; &quot;b&quot; &#x41;")).toBe('× a … "b" A')
  })

  test("pages several engines agree on rise; official docs outrank content farms", () => {
    const a = { url: "https://www.geeksforgeeks.org/x", title: "", snippet: "", source: "exa" }
    const b = { url: "https://developer.mozilla.org/en-US/docs/Web/API/fetch", title: "", snippet: "", source: "exa" }
    const c = { url: "https://blog.example/y?utm_source=z", title: "", snippet: "", source: "exa" }
    expect(fuse([[a, b, c]]).map((hit) => hit.url)[0]).toBe(b.url)
    expect(fuse([[c, b], [{ ...c, url: "https://blog.example/y", source: "wikipedia" }]])[0]?.url).toBe(c.url)
    expect(authority("https://www.w3schools.com/js")).toBeLessThan(1)
  })

  test("a title that is the exact error ranks above a loosely related one", () => {
    const query = "Error: listen EADDRINUSE: address already in use :::3000"
    const exact = { url: "https://stackoverflow.com/q/1", title: "Nodemon Error: listen EADDRINUSE: address already in use :::3000", snippet: "", source: "exa" }
    const loose = { url: "https://stackoverflow.com/q/2", title: "Docker Error bind: address already in use", snippet: "", source: "stackexchange" }
    expect(relevance(query, exact)).toBeGreaterThan(relevance(query, loose))
    expect(fuse([[loose, exact]], 5, query)[0]?.url).toBe(exact.url)
  })
})

describe("page reading and parsing", () => {
  test("extracts text, chunks it and ranks the relevant chunk first", () => {
    const text = htmlToText("<html><script>evil()</script><p>Intro about cooking.</p><p>The --isolate flag runs every test file in a separate process.</p></html>")
    expect(text).not.toContain("evil")
    const chunks = chunk(`${"filler words here. ".repeat(100)}\n\nThe --isolate flag runs every test file separately.`, 400)
    expect(rankChunks("what does --isolate do", chunks)[0]).toBe(chunks.length - 1)
  })

  test("page chrome (menus, sign-up banners, link-only lines) is dropped before ranking", () => {
    const page = "[Create a workspace](https://x)\n\n##### Collectives on Stack Overflow\n\n[Ask Question](https://y)\n\nViewed 1.1m times\n\nThe port is held by another process; find it with lsof -i :3000 and stop it."
    const clean = stripChrome(page)
    expect(clean).not.toContain("Create a workspace")
    expect(clean).not.toContain("Ask Question")
    expect(clean).toContain("lsof -i :3000")
  })

  test("parses Exa's text result", () => {
    const hits = parseExaText("Title: A\nURL: https://a.dev/x\nPublished: 2026-01-02T00:00:00Z\nAuthor: N/A\nHighlights:\nhello world\n\nTitle: B\nURL: https://b.dev\nPublished: N/A\nHighlights:\nsecond")
    expect(hits).toEqual([
      { url: "https://a.dev/x", title: "A", date: "2026-01-02", snippet: "hello world", source: "exa" },
      { url: "https://b.dev", title: "B", snippet: "second", source: "exa" },
    ])
  })
})

describe("hard-case improvements (4.18, worst-case suite)", () => {
  test("an answer resting only on search snippets is sent back once to read a page or use the registry", async () => {
    const research = createWebResearch(config, fakeSources(), freshCache())
    const found = await research.search("s", "who painted the Mona Lisa")
    const url = /\[r1\] .*? — (\S+)/.exec(found)?.[1] ?? ""
    const first = await research.answer("s", { answer: "x", confidence: "high", claims: [{ text: "t", url, quote: "snippet" }] })
    expect(first).toContain("no claim rests on a page you read")
    await research.read("s", "r1")
    const second = await research.answer("s", { answer: "x", confidence: "high", claims: [{ text: "t", url, quote: "Page" }] })
    expect(second).toContain("ACCEPTED")
  })

  test("Node.js and GitHub releases are exact registry sources and count as grounded", async () => {
    const research = createWebResearch(config, fakeSources({
      registry: async (ecosystem, name) => ({ ecosystem, name, latest: "24.21.0", publishedAt: "2026-09-30", url: "https://nodejs.org/dist/index.json", advisories: [], notes: 'newest LTS: v24.21.0 "Krypton" (2026-09-30)' }),
    }), freshCache())
    const out = await research.registry("s", "node", "node")
    expect(out).toContain('newest LTS: v24.21.0 "Krypton"')
    expect(out).not.toContain("advisories")
    const answer = await research.answer("s", { answer: "24.21.0", confidence: "high", claims: [{ text: "lts", url: "https://nodejs.org/dist/index.json", quote: "latest 24.21.0" }] })
    expect(answer).toContain("ACCEPTED")
    expect(answer).toContain("1/1 claims verified")
  })

  test("finds the repository a question names", () => {
    expect(repoIn("issues in github.com/anomalyco/opencode about Zen")).toBe("anomalyco/opencode")
    expect(repoIn("bug in oven-sh/bun mock.module")).toBe("oven-sh/bun")
    expect(repoIn("what is src/a.ts doing")).toBeUndefined()
  })
})
