import { z } from 'zod'

export const USERNAME_MAX_LENGTH = 32
export const PASSWORD_MAX_LENGTH = 128
// Only registration enforces it, so accounts with shorter passwords can still log in.
export const PASSWORD_MIN_LENGTH = 8

// Failed logins per (IP, username) before the API locks that pair out.
export const MAX_FAILED_ATTEMPTS = 5
export const ACCOUNT_LOCK_DURATION_SECONDS = 15 * 60

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60

// Usernames are ASCII letters and numbers only, stored in lowercase.
export const USERNAME_PATTERN = /^[a-zA-Z0-9]*$/
// Removes what USERNAME_PATTERN rejects, so the username field can drop it as it is typed.
export const stripInvalidUsernameCharacters = (value: string) => value.replace(/[^a-zA-Z0-9]/g, '')

// Validated by the web form before calling the server, and again by the API.
export const loginSchema = z.object({
  username: usernameSchema,
  password: z
    .string()
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
})

export type LoginInput = z.infer<typeof loginSchema>

const usernameSchema = z
  .string()
  .min(1, 'Username is required')
  .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`)

// The rules every account must follow, whether it is registered or seeded.
export const newAccountSchema = z.object({
  username: usernameSchema.regex(USERNAME_PATTERN, 'Username can only contain letters and numbers'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
})

export type NewAccount = z.infer<typeof newAccountSchema>

// Validated by the web form before calling the server, and again by the API.
export const registerSchema = newAccountSchema
  .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
  .refine((input) => input.password === input.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type RegisterInput = z.infer<typeof registerSchema>

export const setupStatusSchema = z.object({ needsSetup: z.boolean() })

export type SetupStatus = z.infer<typeof setupStatusSchema>

export const loginResponseSchema = z.object({ accessToken: z.string().min(1) })

export type LoginResponse = z.infer<typeof loginResponseSchema>
