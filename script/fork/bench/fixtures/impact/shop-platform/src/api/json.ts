export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

export const notFound = (): Response => json({ error: "not found" }, 404)
