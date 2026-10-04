import { z } from "zod"

/**
 * web-researcher (fork roadmap 4.18). Works without keys; the optional free keys only raise quotas. Each key can also
 * come from its environment variable (TAVILY_API_KEY, JINA_API_KEY, STACKEXCHANGE_KEY, SEARXNG_URL).
 */
export const WebResearchConfigSchema = z.object({
  /** Register web_search / web_read / registry_lookup / web_answer and the web-researcher agent (default: true) */
  enabled: z.boolean().default(true),
  /** Searches (incl. registry lookups) per web-researcher call before it must answer */
  max_searches: z.number().int().min(1).max(20).default(8),
  /** Page reads per web-researcher call before it must answer */
  max_reads: z.number().int().min(1).max(20).default(6),
  /** Your own SearXNG instance with the json format enabled, e.g. http://localhost:8888 */
  searxng_url: z.string().url().optional(),
  /** Free Tavily key (1000 searches/month): https://app.tavily.com */
  tavily_api_key: z.string().optional(),
  /** Free Jina key (500 page reads/min instead of 20): https://jina.ai/reader */
  jina_api_key: z.string().optional(),
  /** Free Stack Exchange app key (own quota instead of the shared per-IP one): https://stackapps.com/apps/oauth/register */
  stackexchange_key: z.string().optional(),
})

export type WebResearchConfig = z.infer<typeof WebResearchConfigSchema>
