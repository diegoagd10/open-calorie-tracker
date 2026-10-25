import { bearer, send } from './http'

const entryPath = (id: string) => `/v1/water-entries/${encodeURIComponent(id)}`

export const createWaterEntry = (body: unknown, accessToken: string) =>
  send('POST', '/v1/water-entries', { body, headers: bearer(accessToken) })

export const updateWaterEntry = (id: string, body: unknown, accessToken: string) =>
  send('PATCH', entryPath(id), { body, headers: bearer(accessToken) })

export const deleteWaterEntry = (id: string, accessToken: string) =>
  send('DELETE', entryPath(id), { headers: bearer(accessToken) })
