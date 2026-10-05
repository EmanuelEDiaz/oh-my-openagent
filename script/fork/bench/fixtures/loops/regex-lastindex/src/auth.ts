import { TOKEN, TOKEN_ANYWHERE } from "./patterns"

export function isValidToken(value: string): boolean {
  return TOKEN.test(value.trim())
}

export function findTokens(text: string): string[] {
  return [...text.matchAll(TOKEN_ANYWHERE)].map((match) => match[0].toLowerCase())
}
