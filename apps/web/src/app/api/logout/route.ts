import { endSession } from '@/lib/session'
import { status } from '../relay'

export async function POST() {
  await endSession()
  return status(204)
}
