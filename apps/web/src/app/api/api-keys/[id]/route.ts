import type { NextRequest } from 'next/server'
import { deleteApiKey } from '@/clients/api-keys'
import { relayWithSession } from '../../relay'

type Context = { params: Promise<{ id: string }> }

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { id } = await params
  return relayWithSession((token) => deleteApiKey(id, token))
}
