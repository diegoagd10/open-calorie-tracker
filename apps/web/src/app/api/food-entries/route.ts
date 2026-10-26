import type { NextRequest } from 'next/server'
import { createFoodEntry } from '@/clients/food-entries'
import { jsonBody, relayWithSession } from '../relay'

export async function POST(request: NextRequest) {
  const body = await jsonBody(request)
  return relayWithSession((token) => createFoodEntry(body, token))
}
