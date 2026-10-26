import { z } from 'zod'
import { loginSchema } from './auth'
import { PASSWORD_MISMATCH_MESSAGE, newUserSchema } from './users'

// The API answers it with 403, and the dialog shows it under the current password.
export const INCORRECT_CURRENT_PASSWORD_MESSAGE = 'Current password is incorrect.'

// The fields' own rules come first: comparing passwords one of them already breaks says nothing.
const whenFieldsAreValid = { when: ({ issues }: { issues: unknown[] }) => issues.length === 0 }

// Validated by the web form before calling the server, and again by the API. The current password
// follows the login rules, so it is never rejected for a rule only new passwords meet.
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
