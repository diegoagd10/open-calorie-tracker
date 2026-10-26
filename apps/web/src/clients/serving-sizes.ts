import { bearer, get, send } from './http'

export const fetchServingSizes = (accessToken: string) =>
  get('/v1/serving-sizes', bearer(accessToken))

export const createServingSize = (body: unknown, accessToken: string) =>
  send('POST', '/v1/serving-sizes', { body, headers: bearer(accessToken) })
