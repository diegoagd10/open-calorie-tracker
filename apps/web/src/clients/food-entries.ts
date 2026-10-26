import { bearer, send } from './http'

export const createFoodEntry = (body: unknown, accessToken: string) =>
  send('POST', '/v1/food-entries', { body, headers: bearer(accessToken) })
