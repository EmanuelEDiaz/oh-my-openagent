import raw from "./app-config.json"

export type AppConfig = typeof raw

/** Settings shared by the server, the jobs and the integrations. */
export const config: AppConfig = raw
