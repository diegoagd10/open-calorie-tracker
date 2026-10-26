import { describe, expect, it } from 'vite-plus/test'
import {
  API_KEY_EXPIRES_IN,
  API_KEY_NAME_MAX_LENGTH,
  apiKeyCreateSchema,
  apiKeyExpiresAt,
  sameApiKeyName,
} from './api-keys'

describe('apiKeyCreateSchema', () => {
  it.each(API_KEY_EXPIRES_IN)('accepts a key that expires in %s', (expiresIn) => {
    expect(apiKeyCreateSchema.parse({ name: 'Home Assistant', expiresIn })).toEqual({
      name: 'Home Assistant',
      expiresIn,
    })
  })

  it('trims the name and keeps its casing', () => {
    expect(apiKeyCreateSchema.parse({ name: '  Shortcuts on iPhone  ', expiresIn: '90d' })).toEqual(
      { name: 'Shortcuts on iPhone', expiresIn: '90d' },
    )
  })

  it(`accepts a name of ${API_KEY_NAME_MAX_LENGTH} characters, spaces around it aside`, () => {
    const name = 'a'.repeat(API_KEY_NAME_MAX_LENGTH)

    expect(apiKeyCreateSchema.parse({ name: ` ${name} `, expiresIn: '90d' }).name).toBe(name)
  })

  it.each([
    ['an empty name', { name: '', expiresIn: '90d' }],
    ['a name of spaces only', { name: '   ', expiresIn: '90d' }],
    [
      `a name over ${API_KEY_NAME_MAX_LENGTH} characters`,
      { name: 'a'.repeat(API_KEY_NAME_MAX_LENGTH + 1), expiresIn: '90d' },
    ],
    ['a missing name', { expiresIn: '90d' }],
    ['an unknown expiry', { name: 'A', expiresIn: '7d' }],
    ['a missing expiry', { name: 'A' }],
    ['an unknown field', { name: 'A', expiresIn: '90d', extra: 1 }],
  ])('rejects %s', (_case, body) => {
    expect(apiKeyCreateSchema.safeParse(body).success).toBe(false)
  })
})

describe('apiKeyExpiresAt', () => {
  const createdAt = new Date('2026-10-26T14:00:00Z')

  it.each([
    ['30d', '2026-11-25T14:00:00.000Z'],
    ['90d', '2027-01-24T14:00:00.000Z'],
    ['1y', '2027-10-26T14:00:00.000Z'],
  ] as const)('puts a key created now that expires in %s at %s', (expiresIn, expiresAt) => {
    expect(apiKeyExpiresAt(expiresIn, createdAt)?.toISOString()).toBe(expiresAt)
  })

  it('gives no expiry to a key that never expires', () => {
    expect(apiKeyExpiresAt('never', createdAt)).toBeNull()
  })
})

// Two keys of one user cannot share a name, whatever the casing or the spaces around it.
describe('sameApiKeyName', () => {
  it.each([
    ['Home Assistant', 'Home Assistant'],
    ['Home Assistant', 'home assistant'],
    ['Home Assistant', 'HOME ASSISTANT'],
    ['Home Assistant', '  Home Assistant '],
  ])('treats %j and %j as the same name', (a, b) => {
    expect(sameApiKeyName(a, b)).toBe(true)
  })

  it.each([
    ['Home Assistant', 'Home  Assistant'],
    ['Home Assistant', 'Home Assistant 2'],
  ])('treats %j and %j as different names', (a, b) => {
    expect(sameApiKeyName(a, b)).toBe(false)
  })
})
