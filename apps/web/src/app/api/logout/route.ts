import { endSession } from '@/lib/session'
import { status } from '../token-exchange'

// Logging out only deletes the cookie, so it works without a session and with the API down.
export async function POST() {
  await endSession()
  return status(204)
}
