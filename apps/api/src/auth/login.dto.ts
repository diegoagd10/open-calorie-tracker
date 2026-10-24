import { z } from 'zod'

export const USERNAME_MAX_LENGTH = 32
export const PASSWORD_MAX_LENGTH = 128

export const loginSchema = z.object({
  username: z.string().min(1).max(USERNAME_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})

export type LoginDto = z.infer<typeof loginSchema>
