// Retry policy shared by every outgoing request.

export const MAX_ATTEMPTS = 3
export const RETRY_DELAY_MS = 250

export async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await call()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt))
    }
  }
  throw lastError
}
