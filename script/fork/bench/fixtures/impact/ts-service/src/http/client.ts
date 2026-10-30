import { bearerHeader } from "../auth/token"
import { withRetry } from "./retry"

export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  async get(path: string): Promise<unknown> {
    return withRetry(async () => {
      const response = await fetch(`${this.baseUrl}${path}`, { headers: bearerHeader() })
      if (!response.ok) throw new Error(`GET ${path} failed: ${response.status}`)
      return response.json()
    })
  }
}
