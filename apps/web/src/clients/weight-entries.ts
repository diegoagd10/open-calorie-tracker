import { bearer, get, send } from './http'

export const logWeight = (body: unknown, accessToken: string) =>
  send('POST', '/v1/weight-entries', { body, headers: bearer(accessToken) })

export const fetchWeightHistory = (accessToken: string) =>
  get('/v1/weight-history', bearer(accessToken))
