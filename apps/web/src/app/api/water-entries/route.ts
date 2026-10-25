import type { NextRequest } from 'next/server'
import { createWaterEntry } from '@/clients/water-entries'
import { jsonBody, relayWithSession } from '../relay'

export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => createWaterEntry(body, token))
}
