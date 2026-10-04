/** One web-research service per plugin process (fork roadmap 4.18); keys come from config or environment. */
import type { WebResearchConfig } from "../../config/schema/web-research"
import { createWebResearch, type WebResearch } from "./research"

let active: WebResearch | undefined

export function createPluginWebResearch(config: WebResearchConfig | undefined, env: NodeJS.ProcessEnv = process.env): WebResearch {
  const searxngUrl = config?.searxng_url ?? env["SEARXNG_URL"]
  const tavily = config?.tavily_api_key ?? env["TAVILY_API_KEY"]
  const jina = config?.jina_api_key ?? env["JINA_API_KEY"]
  const stackexchange = config?.stackexchange_key ?? env["STACKEXCHANGE_KEY"]
  active = createWebResearch({
    maxSearches: config?.max_searches ?? 8,
    maxReads: config?.max_reads ?? 6,
    keys: {
      ...(searxngUrl ? { searxngUrl } : {}),
      ...(tavily ? { tavily } : {}),
      ...(jina ? { jina } : {}),
      ...(stackexchange ? { stackexchange } : {}),
    },
  })
  return active
}

export function getActiveWebResearch(): WebResearch | undefined {
  return active
}
