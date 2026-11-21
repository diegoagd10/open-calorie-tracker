import { z } from 'zod'
import { loginSchema } from './auth'

export const PASSWORD_MIN_LENGTH = 8

const USERNAME_PATTERN = /^[a-zA-Z0-9]*$/
const USERNAME_INVALID_CHARACTERS = /[^a-zA-Z0-9]/g

export const stripInvalidUsernameCharacters = (value: string) =>
  value.replace(USERNAME_INVALID_CHARACTERS, '')

export const newUserSchema = z.object({
  username: loginSchema.shape.username.regex(
    USERNAME_PATTERN,
    'Username can only contain letters and numbers',
  ),
  password: loginSchema.shape.password.min(
    PASSWORD_MIN_LENGTH,
    `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  ),
})

export type NewUser = z.infer<typeof newUserSchema>

export const PASSWORD_MISMATCH_MESSAGE = 'Passwords do not match'

export const registerSchema = newUserSchema
  .extend({ confirmPassword: z.string() })
  .refine((input) => input.password === input.confirmPassword, {
    message: PASSWORD_MISMATCH_MESSAGE,
    path: ['confirmPassword'],
  })

export type RegisterInput = z.infer<typeof registerSchema>

export const setupStatusSchema = z.object({ needsSetup: z.boolean() })

export type SetupStatus = z.infer<typeof setupStatusSchema>
