import { describe, expect, it } from 'vite-plus/test'
import { PASSWORD_MAX_LENGTH } from './auth'
import { changePasswordSchema } from './password'
import { PASSWORD_MIN_LENGTH } from './users'

const CHANGE = {
  currentPassword: 'correct-horse-battery-staple',
  newPassword: 'new-password-1',
  confirmPassword: 'new-password-1',
}

const withNewPassword = (newPassword: string) => ({
  ...CHANGE,
  newPassword,
  confirmPassword: newPassword,
})

const issuesOf = (input: unknown) => {
  const result = changePasswordSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map(({ path, message }) => ({ path, message }))
}

describe('changePasswordSchema', () => {
  it('accepts a current password and a new one confirmed', () => {
    expect(changePasswordSchema.parse(CHANGE)).toEqual(CHANGE)
  })

  it.each([
    ['a 1-character current password', { ...CHANGE, currentPassword: 'a' }],
    [
      `a ${PASSWORD_MAX_LENGTH}-character current password`,
      { ...CHANGE, currentPassword: 'a'.repeat(PASSWORD_MAX_LENGTH) },
    ],
    [
      `a ${PASSWORD_MIN_LENGTH}-character new password`,
      withNewPassword('a'.repeat(PASSWORD_MIN_LENGTH)),
    ],
    [
      `a ${PASSWORD_MAX_LENGTH}-character new password`,
      withNewPassword('a'.repeat(PASSWORD_MAX_LENGTH)),
    ],
  ])('accepts %s', (_case, input) => {
    expect(changePasswordSchema.safeParse(input).success).toBe(true)
  })

  it.each([
    [
      'an empty current password',
      { ...CHANGE, currentPassword: '' },
      ['currentPassword', 'Password is required'],
    ],
    [
      'a current password that is too long',
      { ...CHANGE, currentPassword: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) },
      ['currentPassword', `Password must be at most ${PASSWORD_MAX_LENGTH} characters`],
    ],
    [
      'a new password that is too short',
      withNewPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)),
      ['newPassword', `Password must be at least ${PASSWORD_MIN_LENGTH} characters`],
    ],
    [
      'a new password that is too long',
      withNewPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)),
      ['newPassword', `Password must be at most ${PASSWORD_MAX_LENGTH} characters`],
    ],
    [
      'a confirmation that does not match',
      { ...CHANGE, confirmPassword: 'new-password-2' },
      ['confirmPassword', 'Passwords do not match'],
    ],
    [
      'a confirmation that differs only by a trailing space',
      { ...CHANGE, confirmPassword: `${CHANGE.newPassword} ` },
      ['confirmPassword', 'Passwords do not match'],
    ],
    [
      'a new password equal to the current one',
      withNewPassword(CHANGE.currentPassword),
      ['newPassword', 'New password must be different from the current password'],
    ],
  ])('rejects %s on its field', (_case, input, [field, message]) => {
    expect(issuesOf(input)).toEqual([{ path: [field], message }])
  })

  it('reports a short new password before checking the confirmation', () => {
    expect(issuesOf({ ...CHANGE, newPassword: 'short', confirmPassword: 'shor' })).toEqual([
      {
        path: ['newPassword'],
        message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
      },
    ])
  })

  it.each([
    ['a missing current password', { newPassword: 'new-password-1', confirmPassword: 'x' }],
    ['a missing new password', { currentPassword: 'x', confirmPassword: 'new-password-1' }],
    ['a missing confirmation', { currentPassword: 'x', newPassword: 'new-password-1' }],
    ['a non-string current password', { ...CHANGE, currentPassword: 42 }],
    ['no body', undefined],
  ])('rejects %s', (_case, input) => {
    expect(changePasswordSchema.safeParse(input).success).toBe(false)
  })
})
