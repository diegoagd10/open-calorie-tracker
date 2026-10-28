import { bearer, send } from './http'

const entryPath = (id: string) => `/v1/food-entries/${encodeURIComponent(id)}`

export const createFoodEntry = (body: unknown, accessToken: string) =>
  send('POST', '/v1/food-entries', { body, headers: bearer(accessToken) })

export const updateFoodEntry = (id: string, body: unknown, accessToken: string) =>
  send('PATCH', entryPath(id), { body, headers: bearer(accessToken) })

export const deleteFoodEntry = (id: string, accessToken: string) =>
  send('DELETE', entryPath(id), { headers: bearer(accessToken) })
