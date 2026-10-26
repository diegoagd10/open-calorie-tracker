import type { NextRequest } from 'next/server'
import { changePassword } from '@/clients/password'
import { jsonBody, relayWithSession } from '../relay'

// 403: the current password is wrong, which the dialog shows under its field.
export async function PUT(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => changePassword(body, token), [403])
}
