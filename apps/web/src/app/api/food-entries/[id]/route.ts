import type { NextRequest } from 'next/server'
import { deleteFoodEntry, updateFoodEntry } from '@/clients/food-entries'
import { jsonBody, relayWithSession } from '../../relay'

type Context = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Context) {
  const { id } = await params
  const body = await jsonBody(request)
  return relayWithSession((token) => updateFoodEntry(id, body, token))
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params
  return relayWithSession((token) => deleteFoodEntry(id, token))
}
