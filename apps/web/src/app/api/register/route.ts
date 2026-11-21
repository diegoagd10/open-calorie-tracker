import { registerSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { register } from '@/clients/users'
import { jsonBody, status } from '../relay'
import { clientIp, exchangeForSession } from '../token-exchange'

const FORWARDED_STATUSES = new Set([400, 409, 429])

export async function POST(request: NextRequest) {
  const input = registerSchema.safeParse(await jsonBody(request))
  if (!input.success) return status(400)

  return exchangeForSession(() => register(input.data, clientIp(request)), FORWARDED_STATUSES)
}
