/**
 * One web-research service per OpenCode instance (project folder; fork roadmap 4.18, incidents H13): keys come from
 * the config of that folder or the environment.
 */
import type { WebResearchConfig } from "../../config/schema/web-research"
import { createInstanceRegistry } from "../../shared/instance-registry"
import { createWebResearch, type WebResearch } from "./research"

const services = createInstanceRegistry<WebResearch>()
const releases = new Map<string, () => void>()

/** OpenCode disposed the instance of `directory` (fork incidents H12): forget its service. */
export function releasePluginWebResearch(directory: string): void {
  releases.get(directory)?.()
  releases.delete(directory)
}

export function createPluginWebResearch(config: WebResearchConfig | undefined, env: NodeJS.ProcessEnv = process.env, directory = ""): WebResearch {
  const searxngUrl = config?.searxng_url ?? env["SEARXNG_URL"]
  const tavily = config?.tavily_api_key ?? env["TAVILY_API_KEY"]
  const jina = config?.jina_api_key ?? env["JINA_API_KEY"]
  const stackexchange = config?.stackexchange_key ?? env["STACKEXCHANGE_KEY"]
  const service = createWebResearch({
    maxSearches: config?.max_searches ?? 8,
    maxReads: config?.max_reads ?? 6,
    keys: {
      ...(searxngUrl ? { searxngUrl } : {}),
      ...(tavily ? { tavily } : {}),
      ...(jina ? { jina } : {}),
      ...(stackexchange ? { stackexchange } : {}),
    },
  })
  releases.set(directory, services.register(directory, service))
  return service
}

export function getActiveWebResearch(directory?: string): WebResearch | undefined {
  return services.get(directory)
}
