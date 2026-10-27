import { bearer, send } from './http'

export const fetchProfile = (accessToken: string) =>
  send('GET', '/v1/settings/profile', { headers: bearer(accessToken) })
