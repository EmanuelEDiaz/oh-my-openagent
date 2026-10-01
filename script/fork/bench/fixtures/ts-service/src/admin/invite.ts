import { isValidEmail } from "../users/validate"

export function inviteAll(emails: readonly string[]): string[] {
  return emails.filter((email) => isValidEmail(email)).map((email) => `invited ${email}`)
}
