import { z } from 'zod'

export const USERNAME_MAX_LENGTH = 32
export const PASSWORD_MAX_LENGTH = 128

export const MAX_FAILED_ATTEMPTS = 5
export const ACCOUNT_LOCK_DURATION_SECONDS = 15 * 60

export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export const loginSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters`),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`),
})

export type LoginInput = z.infer<typeof loginSchema>

export const loginResponseSchema = z.object({ accessToken: z.string().min(1) })

export type LoginResponse = z.infer<typeof loginResponseSchema>
