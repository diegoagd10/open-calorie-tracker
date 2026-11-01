import type { NextRequest } from 'next/server'
import { fetchDailySummaries } from '@/clients/daily-summaries'
import { relayWithSession } from '../relay'

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const range = {
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    timeZone: searchParams.get('timeZone') ?? '',
  }
  return relayWithSession((token) => fetchDailySummaries(range, token))
}
