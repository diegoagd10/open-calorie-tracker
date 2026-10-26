import type { NextRequest } from 'next/server'
import { createApiKey, fetchApiKeys } from '@/clients/api-keys'
import { jsonBody, relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchApiKeys(token))
}

// 409: the user already has a key with that name, which the dialog shows under the name.
export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => createApiKey(body, token), [409])
}
