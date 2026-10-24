import type { NextRequest } from 'next/server'
import { fetchDailyLog } from '@/clients/daily-log'
import { sessionToken } from '@/lib/session'
import { status } from '../token-exchange'

// API statuses the page knows how to handle; anything else is reported as a generic failure.
const FORWARDED_STATUSES = new Set([400, 401])

export async function GET(request: NextRequest) {
  const token = await sessionToken()
  if (token === undefined) return status(401)

  const { searchParams } = request.nextUrl
  const day = { date: searchParams.get('date') ?? '', timeZone: searchParams.get('timeZone') ?? '' }

  let upstream: Response
  try {
    upstream = await fetchDailyLog(day, token)
  } catch {
    return status(502)
  }

  if (FORWARDED_STATUSES.has(upstream.status)) return status(upstream.status)
  if (!upstream.ok) return status(502)

  const body: unknown = await upstream.json().catch(() => undefined)
  if (body === undefined) return status(502)
  return Response.json(body)
}
