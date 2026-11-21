import { z } from 'zod'
import { loginSchema } from './auth'
import { PASSWORD_MISMATCH_MESSAGE, newUserSchema } from './users'

export const INCORRECT_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect.'

const whenFieldsAreValid = { when: ({ issues }: { issues: unknown[] }) => issues.length === 0 }

export const changePasswordSchema = z
  .object({
    currentPassword: loginSchema.shape.password,
    newPassword: newUserSchema.shape.password,
    confirmPassword: z.string(),
  })
  .refine((input) => input.newPassword === input.confirmPassword, {
    message: PASSWORD_MISMATCH_MESSAGE,
    path: ['confirmPassword'],
    ...whenFieldsAreValid,
  })
  .refine((input) => input.newPassword !== input.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
    ...whenFieldsAreValid,
  })

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
