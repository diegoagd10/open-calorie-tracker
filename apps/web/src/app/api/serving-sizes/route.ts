import type { NextRequest } from 'next/server'
import { createServingSize, fetchServingSizes } from '@/clients/serving-sizes'
import { jsonBody, relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchServingSizes(token))
}

export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => createServingSize(body, token))
}
