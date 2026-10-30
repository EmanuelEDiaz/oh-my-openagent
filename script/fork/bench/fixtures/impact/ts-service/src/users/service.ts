import type { HttpClient } from "../http/client"
import { isValidEmail } from "./validate"

export class UserService {
  constructor(private readonly http: HttpClient) {}

  async findByEmail(email: string): Promise<unknown> {
    if (!isValidEmail(email)) throw new Error("invalid email")
    return this.http.get(`/users?email=${encodeURIComponent(email)}`)
  }
}
