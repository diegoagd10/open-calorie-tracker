import { bearer, send } from './http'

export const changePassword = (body: unknown, accessToken: string) =>
  send('PUT', '/v1/settings/password', { body, headers: bearer(accessToken) })
