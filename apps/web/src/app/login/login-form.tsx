'use client'

import { useRouter } from 'next/navigation'
import {
  GENERIC_ERROR_MESSAGE,
  type LoginInput,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  loginSchema,
} from '@open-calorie-tracker/shared'
import { type FormEvent, useState } from 'react'
import { AuthForm } from '@/components/auth-form'
import { Field } from '@/components/field'
import { type FieldErrors, fieldErrorsFrom, passwordInput, usernameInput } from '@/lib/form'

type FieldName = keyof LoginInput

const FIELDS: readonly FieldName[] = ['username', 'password']

const ERROR_MESSAGES: Record<number, string> = {
  401: 'Invalid username or password',
  423: 'Your account has been locked after too many failed login attempts. Please try again later.',
  429: 'Too many login attempts. Please wait a moment and try again.',
}

const INPUTS: Record<FieldName, (value: string) => string> = {
  username: usernameInput,
  password: passwordInput,
}

export function LoginForm() {
  const router = useRouter()
  const [values, setValues] = useState<LoginInput>({ username: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<FieldName>>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  // Required fields are enforced by the disabled button; the schema still checks the lengths.
  const canSubmit = values.username !== '' && values.password !== '' && !pending

  const handleChange = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: INPUTS[name](value) }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setFormError(undefined)

    const input = loginSchema.safeParse(values)
    if (!input.success) {
      setFieldErrors(fieldErrorsFrom(FIELDS, input.error.issues))
      return
    }
    setFieldErrors({})

    setPending(true)
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input.data),
      })
      if (response.ok) {
        router.replace('/')
        return
      }
      setFormError(ERROR_MESSAGES[response.status] ?? GENERIC_ERROR_MESSAGE)
    } catch {
      setFormError(GENERIC_ERROR_MESSAGE)
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthForm
      title="Log in"
      description="Welcome back. Enter your details to continue."
      submitLabel="Log in"
      canSubmit={canSubmit}
      pending={pending}
      error={formError}
      onSubmit={handleSubmit}
    >
      <Field
        label="Username"
        name="username"
        type="text"
        autoComplete="username"
        maxLength={USERNAME_MAX_LENGTH}
        value={values.username}
        error={fieldErrors.username}
        onChange={handleChange}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={values.password}
        error={fieldErrors.password}
        onChange={handleChange}
      />
    </AuthForm>
  )
}
