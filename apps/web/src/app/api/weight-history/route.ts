import { fetchWeightHistory } from '@/clients/weight-entries'
import { relayWithSession } from '../relay'

export function GET() {
  return relayWithSession((token) => fetchWeightHistory(token))
}
