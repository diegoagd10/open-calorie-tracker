'use client'

import { useRouter } from 'next/navigation'
import { type LoginInput, loginSchema } from '@open-calorie-tracker/shared'
import { type FormEvent, useState } from 'react'
import { Alert } from '@/components/alert'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'

type FieldErrors = Partial<Record<keyof LoginInput, string>>

const ERROR_MESSAGES: Record<number, string> = {
  401: 'Invalid username or password',
  423: 'Your account has been locked after too many failed login attempts. Please try again later.',
  429: 'Too many login attempts. Please wait a moment and try again.',
}

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
  const [values, setValues] = useState<LoginInput>({ username: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [pending, setPending] = useState(false)

  // Required fields are enforced by the disabled button; the schema still checks the lengths.
  const canSubmit = values.username !== '' && values.password !== '' && !pending

  const handleChange = (name: keyof LoginInput, value: string) => {
    setValues((current) => ({ ...current, [name]: value }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    setFormError(undefined)

    const input = loginSchema.safeParse(values)
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
      setFormError(ERROR_MESSAGES[response.status] ?? GENERIC_ERROR_MESSAGE)
    } catch {
      setFormError(GENERIC_ERROR_MESSAGE)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex flex-col items-center gap-3 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-xl bg-blue-600 text-lg font-semibold text-white shadow-sm"
        >
          OC
        </span>
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Open Calorie Tracker</p>
      </div>

      <form
        noValidate
        aria-labelledby="login-title"
        onSubmit={handleSubmit}
        className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-col gap-1">
          <h1 id="login-title" className="text-2xl font-semibold tracking-tight">
            Log in
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Welcome back. Enter your details to continue.
          </p>
        </div>

        {formError !== undefined && <Alert>{formError}</Alert>}

        <Field
          label="Username"
          name="username"
          type="text"
          autoComplete="username"
          value={values.username}
          error={fieldErrors.username}
          onChange={handleChange}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={values.password}
          error={fieldErrors.password}
          onChange={handleChange}
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none dark:disabled:bg-gray-800 dark:disabled:text-gray-500"
        >
          {pending && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          )}
          Log in
        </button>
      </form>
    </div>
  )
}

type FieldProps = {
  label: string
  name: keyof LoginInput
  type: 'text' | 'password'
  autoComplete: string
  value: string
  error: string | undefined
  onChange: (name: keyof LoginInput, value: string) => void
}

function Field({ label, name, type, autoComplete, value, error, onChange }: FieldProps) {
  const errorId = `${name}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 shadow-xs transition-colors outline-none placeholder:text-gray-400 focus:border-blue-600 focus:ring-3 focus:ring-blue-600/20 aria-invalid:border-red-500 aria-invalid:focus:ring-red-500/20 dark:border-gray-700 dark:bg-gray-950"
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}
