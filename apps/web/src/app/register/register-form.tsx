'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  GENERIC_ERROR_MESSAGE,
  PASSWORD_MAX_LENGTH,
  type RegisterInput,
  USERNAME_MAX_LENGTH,
  registerSchema,
} from '@open-calorie-tracker/shared'
import { type FormEvent, type ReactNode, useState } from 'react'
import { AuthForm } from '@/components/auth-form'
import { Field } from '@/components/field'
import { type FieldErrors, fieldErrorsFrom, passwordInput, usernameInput } from '@/lib/form'

type FieldName = keyof RegisterInput

const FIELDS: readonly FieldName[] = ['username', 'password', 'confirmPassword']

const ACCOUNT_EXISTS_ERROR = (
  <>
    An account already exists.{' '}
    <Link href="/login" className="font-medium underline">
      Log in instead
    </Link>
  </>
)

const ERROR_MESSAGES: Record<number, ReactNode> = {
  409: ACCOUNT_EXISTS_ERROR,
  429: 'Too many attempts. Please wait a moment and try again.',
}

const INPUTS: Record<FieldName, (value: string) => string> = {
  username: usernameInput,
  password: passwordInput,
  confirmPassword: passwordInput,
}

export function RegisterForm() {
  const router = useRouter()
  const [values, setValues] = useState<RegisterInput>({
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<FieldName>>({})
  const [formError, setFormError] = useState<ReactNode>()
  const [pending, setPending] = useState(false)

  // Required fields are enforced by the disabled button; the schema checks everything else.
  const canSubmit = FIELDS.every((name) => values[name] !== '') && !pending

  const handleChange = (name: FieldName, value: string) => {
    setValues((current) => ({ ...current, [name]: INPUTS[name](value) }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setFormError(undefined)

    const input = registerSchema.safeParse(values)
    if (!input.success) {
      setFieldErrors(fieldErrorsFrom(FIELDS, input.error.issues))
      return
    }
    setFieldErrors({})

    setPending(true)
    try {
      const response = await fetch('/api/register', {
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
      title="Create account"
      description="Set up the account you will use to track your calories."
      submitLabel="Create account"
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
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={values.password}
        error={fieldErrors.password}
        onChange={handleChange}
      />
      <Field
        label="Confirm password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={values.confirmPassword}
        error={fieldErrors.confirmPassword}
        onChange={handleChange}
      />
    </AuthForm>
  )
}
