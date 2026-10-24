import type { FormEvent, ReactNode } from 'react'
import { Alert } from './alert'

type AuthFormProps = {
  title: string
  description: string
  submitLabel: string
  canSubmit: boolean
  pending: boolean
  error: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}

// The card shared by the login and register pages; the title also names the form.
export function AuthForm({
  title,
  description,
  submitLabel,
  canSubmit,
  pending,
  error,
  onSubmit,
  children,
}: AuthFormProps) {
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
        aria-labelledby="auth-form-title"
        onSubmit={onSubmit}
        className="flex flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-col gap-1">
          <h1 id="auth-form-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        </div>

        {error !== undefined && <Alert>{error}</Alert>}

        {children}

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
          {submitLabel}
        </button>
      </form>
    </div>
  )
}
