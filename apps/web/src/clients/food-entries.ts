import { bearer, send } from './http'

export const createFoodEntry = (body: unknown, accessToken: string) =>
  send('POST', '/v1/food-entries', { body, headers: bearer(accessToken) })

export const updateFoodEntry = (id: string, body: unknown, accessToken: string) =>
  send('PATCH', `/v1/food-entries/${encodeURIComponent(id)}`, {
    body,
    headers: bearer(accessToken),
  })
