export function bearerHeader(): Record<string, string> {
  const token = process.env.API_TOKEN
  return token ? { Authorization: `Bearer ${token}` } : {}
}
