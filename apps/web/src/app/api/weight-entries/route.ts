import type { NextRequest } from 'next/server'
import { logWeight } from '@/clients/weight-entries'
import { jsonBody, relayWithSession } from '../relay'

export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => logWeight(body, token))
}
