import { fetchProfile } from '@/clients/profile'
import { relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchProfile(token))
}
