import { describe, expect, it } from 'vite-plus/test'
import { PASSWORD_MAX_LENGTH, USERNAME_MAX_LENGTH, loginResponseSchema, loginSchema } from './auth'

const VALID = { username: 'ana', password: 'correct-horse-battery-staple' }

const messagesFor = (input: unknown) => {
  const result = loginSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('loginSchema', () => {
  it('accepts a username and password', () => {
    expect(loginSchema.parse(VALID)).toEqual(VALID)
  })

  it('drops unknown fields', () => {
    expect(loginSchema.parse({ ...VALID, role: 'admin' })).toEqual(VALID)
  })

  it.each([
    ['username', 'a'.repeat(USERNAME_MAX_LENGTH)],
    ['password', 'a'.repeat(PASSWORD_MAX_LENGTH)],
  ])('accepts a %s at its maximum length', (field, value) => {
    expect(loginSchema.safeParse({ ...VALID, [field]: value }).success).toBe(true)
  })

  it.each([
    ['an empty username', { ...VALID, username: '' }, 'Username is required'],
    ['an empty password', { ...VALID, password: '' }, 'Password is required'],
    [
      'a username that is too long',
      { ...VALID, username: 'a'.repeat(USERNAME_MAX_LENGTH + 1) },
      `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
    ],
    [
      'a password that is too long',
      { ...VALID, password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) },
      `Password must be at most ${PASSWORD_MAX_LENGTH} characters`,
    ],
  ])('rejects %s', (_case, input, message) => {
    expect(messagesFor(input)).toEqual([message])
  })

  it.each([
    ['a missing username', { password: VALID.password }],
    ['a missing password', { username: VALID.username }],
    ['a non-string username', { ...VALID, username: 42 }],
    ['no body', undefined],
  ])('rejects %s', (_case, input) => {
    expect(loginSchema.safeParse(input).success).toBe(false)
  })

  it('reports every invalid field at once', () => {
    expect(messagesFor({ username: '', password: '' })).toEqual([
      'Username is required',
      'Password is required',
    ])
  })
})

describe('loginResponseSchema', () => {
  it('accepts an access token', () => {
    expect(loginResponseSchema.parse({ accessToken: 'token' })).toEqual({ accessToken: 'token' })
  })

  it.each([
    ['an empty access token', { accessToken: '' }],
    ['a missing access token', {}],
    ['a non-string access token', { accessToken: 42 }],
  ])('rejects %s', (_case, body) => {
    expect(loginResponseSchema.safeParse(body).success).toBe(false)
  })
})
