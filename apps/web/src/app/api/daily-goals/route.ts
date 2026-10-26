import type { NextRequest } from 'next/server'
import { fetchDailyGoals, updateDailyGoals } from '@/clients/daily-goals'
import { jsonBody, relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchDailyGoals(token))
}

export async function PATCH(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => updateDailyGoals(body, token))
}
