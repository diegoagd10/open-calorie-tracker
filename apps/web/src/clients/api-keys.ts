import { bearer, send } from './http'

const API_KEYS_PATH = '/v1/settings/api-keys'

const keyPath = (id: string) => `${API_KEYS_PATH}/${encodeURIComponent(id)}`

export const fetchApiKeys = (accessToken: string) =>
  send('GET', API_KEYS_PATH, { headers: bearer(accessToken) })

export const createApiKey = (body: unknown, accessToken: string) =>
  send('POST', API_KEYS_PATH, { body, headers: bearer(accessToken) })

export const deleteApiKey = (id: string, accessToken: string) =>
  send('DELETE', keyPath(id), { headers: bearer(accessToken) })
