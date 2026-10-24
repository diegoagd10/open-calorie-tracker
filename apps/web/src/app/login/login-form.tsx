'use client'

import { useRouter } from 'next/navigation'
import { type FormEvent, useState } from 'react'
import { type LoginInput, loginSchema } from '@/lib/login'

type FieldErrors = Partial<Record<keyof LoginInput, string>>

const ERROR_MESSAGES: Record<number, string> = {
  401: 'Invalid username or password',
  423: 'Your account has been locked after too many failed login attempts. Please try again later.',
  429: 'Too many login attempts. Please wait a moment and try again.',
}

const GENERIC_ERROR = 'Something went wrong. Please try again later.'

const fieldErrorsFrom = (issues: { path: PropertyKey[]; message: string }[]): FieldErrors => {
  const errors: FieldErrors = {}
  for (const { path, message } of issues) {
    const [field] = path
    if ((field === 'username' || field === 'password') && errors[field] === undefined) {
      errors[field] = message
    }
  }
  return errors
}

export function LoginForm() {
  const router = useRouter()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFormError(undefined)

    const data = new FormData(event.currentTarget)
    const input = loginSchema.safeParse({
      username: data.get('username'),
      password: data.get('password'),
    })
    if (!input.success) {
      setFieldErrors(fieldErrorsFrom(input.error.issues))
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
      setFormError(ERROR_MESSAGES[response.status] ?? GENERIC_ERROR)
    } catch {
      setFormError(GENERIC_ERROR)
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      noValidate
      aria-labelledby="login-title"
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <h1 id="login-title" className="text-2xl font-semibold">
        Log in
      </h1>

      <Field
        label="Username"
        name="username"
        type="text"
        autoComplete="username"
        error={fieldErrors.username}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        error={fieldErrors.password}
      />

      {formError !== undefined && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-black px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
      >
        Log in
      </button>
    </form>
  )
}

type FieldProps = {
  label: string
  name: keyof LoginInput
  type: 'text' | 'password'
  autoComplete: string
  error: string | undefined
}

function Field({ label, name, type, autoComplete, error }: FieldProps) {
  const errorId = `${name}-error`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        className="rounded-md border border-gray-300 px-3 py-2 aria-invalid:border-red-500"
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
