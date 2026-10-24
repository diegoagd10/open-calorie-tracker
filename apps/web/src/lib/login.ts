import { z } from 'zod'

export const USERNAME_MAX_LENGTH = 32
export const PASSWORD_MAX_LENGTH = 128

// Shared by the form (validates before calling the server) and the route handler.
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

export const ACCESS_TOKEN_COOKIE = 'access_token'
