import { z } from 'zod'

export const API_KEY_NAME_MAX_LENGTH = 50

export const API_KEY_EXPIRES_IN = ['30d', '90d', '1y', 'never'] as const

export type ApiKeyExpiresIn = (typeof API_KEY_EXPIRES_IN)[number]

export const API_KEY_NAME_TAKEN_ERROR = 'A key with this name already exists.'

export const apiKeyCreateSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(API_KEY_NAME_MAX_LENGTH, `Name must be at most ${API_KEY_NAME_MAX_LENGTH} characters`),
  expiresIn: z.enum(API_KEY_EXPIRES_IN),
})

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>

export type ApiKey = {
  id: number
  name: string
  key: string
  preview: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

export const apiKeyExpiresAt = (expiresIn: ApiKeyExpiresIn, createdAt: Date): Date | null => {
  switch (expiresIn) {
    case '30d':
      return new Date(createdAt.getTime() + 30 * DAY_MS)
    case '90d':
      return new Date(createdAt.getTime() + 90 * DAY_MS)
    case '1y': {
      const expiresAt = new Date(createdAt)
      expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
      return expiresAt
    }
    case 'never':
      return null
  }
}

// oxlint-disable-next-line local/no-comments
// Ignores the spaces around a name and the case of ASCII letters, like SQLite's NOCASE, which the
// API's unique index uses.
const comparableName = (name: string) =>
  name.trim().replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase())

export const sameApiKeyName = (a: string, b: string) => comparableName(a) === comparableName(b)

export const API_SCOPES = [
  'daily-log:read',
  'food-entries:read',
  'food-entries:write',
  'water-entries:read',
  'water-entries:write',
  'weight-entries:read',
  'weight-entries:write',
  'serving-sizes:read',
  'serving-sizes:write',
  'products:read',
] as const

export type ApiScope = (typeof API_SCOPES)[number]

export const API_ACCESS_TOKEN_TTL_SECONDS = 10 * 60

export const INVALID_API_KEY_MESSAGE = 'Invalid API key'

export const INSUFFICIENT_SCOPE_MESSAGE = 'Insufficient scope'

export const apiTokenRequestSchema = z.strictObject({ apiKey: z.string() })

export type ApiTokenRequest = z.infer<typeof apiTokenRequestSchema>

export type ApiTokenResponse = {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
  scopes: ApiScope[]
}
