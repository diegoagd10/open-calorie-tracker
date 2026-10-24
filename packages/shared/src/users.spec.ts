import type { z } from 'zod'
import { describe, expect, it } from 'vite-plus/test'
import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH } from './auth'
import {
  PASSWORD_MIN_LENGTH,
  newUserSchema,
  registerSchema,
  setupStatusSchema,
  stripInvalidUsernameCharacters,
} from './users'

const issueMessages = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

const NEW_USER = { username: 'Ana123', password: 'correct-horse-battery-staple' }

describe('newUserSchema', () => {
  it('accepts a username of letters and numbers and a long enough password', () => {
    expect(newUserSchema.parse(NEW_USER)).toEqual(NEW_USER)
  })

  it.each([
    ['username', 'a'.repeat(USERNAME_MAX_LENGTH)],
    ['password', 'a'.repeat(PASSWORD_MIN_LENGTH)],
    ['password', 'a'.repeat(PASSWORD_MAX_LENGTH)],
  ])('accepts a %s at its length limit', (field, value) => {
    expect(newUserSchema.safeParse({ ...NEW_USER, [field]: value }).success).toBe(true)
  })

  it.each(['ana_1', 'ana 1', 'josé', 'peña'])('rejects the username %j', (username) => {
    expect(issueMessages(newUserSchema, { ...NEW_USER, username })).toEqual([
      'Username can only contain letters and numbers',
    ])
  })

  it.each([
    [
      'a username that is too long',
      { ...NEW_USER, username: 'a'.repeat(USERNAME_MAX_LENGTH + 1) },
      `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
    ],
    [
      'a password that is too short',
      { ...NEW_USER, password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1) },
      `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    ],
    [
      'a password that is too long',
      { ...NEW_USER, password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) },
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    ],
  ])('rejects %s', (_case, input, message) => {
    expect(issueMessages(newUserSchema, input)).toEqual([message])
  })
})

describe('registerSchema', () => {
  const REGISTRATION = { ...NEW_USER, confirmPassword: NEW_USER.password }

  it('accepts matching passwords', () => {
    expect(registerSchema.parse(REGISTRATION)).toEqual(REGISTRATION)
  })

  it('rejects a confirmation that does not match, on the confirmation field', () => {
    const result = registerSchema.safeParse({ ...REGISTRATION, confirmPassword: 'other' })

    expect(result.error?.issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: ['confirmPassword'], message: 'Passwords do not match' },
    ])
  })

  it('rejects a missing confirmation', () => {
    expect(registerSchema.safeParse(NEW_USER).success).toBe(false)
  })

  it('applies the new user rules', () => {
    expect(issueMessages(registerSchema, { ...REGISTRATION, username: 'ana_1' })).toEqual([
      'Username can only contain letters and numbers',
    ])
  })
})

describe('stripInvalidUsernameCharacters', () => {
  it.each([
    ['Ana_1 é-ñ!2', 'Ana12'],
    ['josé.peña', 'jospea'],
    ['Ana123', 'Ana123'],
    ['_-!', ''],
  ])('turns %j into %j', (value, expected) => {
    expect(stripInvalidUsernameCharacters(value)).toBe(expected)
  })
})

describe('setupStatusSchema', () => {
  it.each([true, false])('accepts needsSetup: %s', (needsSetup) => {
    expect(setupStatusSchema.parse({ needsSetup })).toEqual({ needsSetup })
  })

  it.each([
    ['a missing flag', {}],
    ['a non-boolean flag', { needsSetup: 'yes' }],
  ])('rejects %s', (_case, body) => {
    expect(setupStatusSchema.safeParse(body).success).toBe(false)
  })
})
