import { loginSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { login } from '@/clients/auth'
import { jsonBody, status } from '../relay'
import { clientIp, exchangeForSession } from '../token-exchange'

const FORWARDED_STATUSES = new Set([400, 401, 423, 429])

export async function POST(request: NextRequest) {
  const input = loginSchema.safeParse(await jsonBody(request))
  if (!input.success) return status(400)

  return exchangeForSession(() => login(input.data, clientIp(request)), FORWARDED_STATUSES)
}
