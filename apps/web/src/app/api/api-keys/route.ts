import type { NextRequest } from 'next/server'
import { createApiKey, fetchApiKeys } from '@/clients/api-keys'
import { jsonBody, relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchApiKeys(token))
}

export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => createApiKey(body, token), [409])
}
