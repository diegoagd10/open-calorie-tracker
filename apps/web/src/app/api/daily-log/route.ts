import type { NextRequest } from 'next/server'
import { fetchDailyLog } from '@/clients/daily-log'
import { relayWithSession } from '../relay'

export function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const day = { date: searchParams.get('date') ?? '', timeZone: searchParams.get('timeZone') ?? '' }
  return relayWithSession((token) => fetchDailyLog(day, token))
}
