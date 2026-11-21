import type { NextRequest } from 'next/server'
import { changePassword } from '@/clients/password'
import { jsonBody, relayWithSession } from '../relay'

export async function PUT(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => changePassword(body, token), [403])
}
