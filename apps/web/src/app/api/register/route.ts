import { registerSchema } from '@open-calorie-tracker/shared'
import type { NextRequest } from 'next/server'
import { register } from '@/clients/users'
import { clientIp, exchangeForSession, status } from '../token-exchange'

const FORWARDED_STATUSES = new Set([400, 409, 429])

// Registering also logs the new account in.
export async function POST(request: NextRequest) {
  const input = registerSchema.safeParse(await request.json().catch(() => undefined))
  if (!input.success) return status(400)

  return exchangeForSession(() => register(input.data, clientIp(request)), FORWARDED_STATUSES)
}
