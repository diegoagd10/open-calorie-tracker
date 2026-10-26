import { z } from 'zod'

export const API_KEY_NAME_MAX_LENGTH = 50

// How long a new key lasts. "1y" lands on the same date next year.
export const API_KEY_EXPIRES_IN = ['30d', '90d', '1y', 'never'] as const

export type ApiKeyExpiresIn = (typeof API_KEY_EXPIRES_IN)[number]

// The API answers it with 409, and the dialog shows it under the name while typing.
export const API_KEY_NAME_TAKEN_ERROR = 'A key with this name already exists.'

// The body of POST /v1/settings/api-keys. Validated by the dialog before calling the server, and
// again by the API.
export const apiKeyCreateSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(API_KEY_NAME_MAX_LENGTH, `Name must be at most ${API_KEY_NAME_MAX_LENGTH} characters`),
  expiresIn: z.enum(API_KEY_EXPIRES_IN),
})

export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>

// A key as the API answers it, with the full key so it can be copied anytime. Instants are ISO
// strings; lastUsedAt is null until the key is used, expiresAt is null for a key that never
// expires.
export type ApiKey = {
  id: number
  name: string
  key: string
  // "oct_live_" + the first 4 and the last 4 characters of the random part.
  preview: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// When a key created at `createdAt` expires, or null when it never does.
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

// Ignores the spaces around a name and the case of ASCII letters, like SQLite's NOCASE, which the
// API's unique index uses.
const comparableName = (name: string) =>
  name.trim().replaceAll(/[A-Z]/g, (letter) => letter.toLowerCase())

// Whether two of a user's keys would share a name.
export const sameApiKeyName = (a: string, b: string) => comparableName(a) === comparableName(b)
