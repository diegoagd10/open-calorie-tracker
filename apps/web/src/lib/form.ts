import {
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  stripInvalidUsernameCharacters,
} from '@open-calorie-tracker/shared'

export type FieldErrors<Field extends string> = Partial<Record<Field, string>>

// Keeps the first schema message for each field of the form.
export const fieldErrorsFrom = <Field extends string>(
  fields: readonly Field[],
  issues: { path: PropertyKey[]; message: string }[],
): FieldErrors<Field> => {
  const errors: FieldErrors<Field> = {}
  for (const { path, message } of issues) {
    const field = fields.find((name) => name === path[0])
    if (field !== undefined && errors[field] === undefined) errors[field] = message
  }
  return errors
}

// The inputs already stop at their maxLength; slicing also covers values set by script.
export const usernameInput = (value: string) =>
  stripInvalidUsernameCharacters(value).slice(0, USERNAME_MAX_LENGTH)

export const passwordInput = (value: string) => value.slice(0, PASSWORD_MAX_LENGTH)
