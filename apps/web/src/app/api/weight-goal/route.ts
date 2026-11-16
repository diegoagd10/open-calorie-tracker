import type { NextRequest } from 'next/server'
import { fetchWeightGoal, saveWeightGoal } from '@/clients/weight-goal'
import { jsonBody, relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchWeightGoal(token))
}

export async function PUT(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => saveWeightGoal(body, token))
}
