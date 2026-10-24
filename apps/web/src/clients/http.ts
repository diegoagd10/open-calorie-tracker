const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001'

export const get = (path: string) => fetch(`${apiUrl}${path}`, { cache: 'no-store' })

// `clientIp` is forwarded because lockout and rate limiting are per client IP, not per
// Next.js server.
export const post = (path: string, body: unknown, clientIp: string) =>
  fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': clientIp },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
