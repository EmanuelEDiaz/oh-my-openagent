export type Config = { readonly port: number; readonly debug: boolean }

export const DEFAULTS: Config = { port: 3000, debug: false }

export class ConfigError extends Error {}

/** The file's text, or undefined when it does not exist. */
export type ReadText = (path: string) => string | undefined

export function loadConfig(path: string, read: ReadText): Config {
  const text = read(path)
  return { ...DEFAULTS, ...(JSON.parse(text as string) as Partial<Config>) }
}
