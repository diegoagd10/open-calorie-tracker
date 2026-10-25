import type { FormEvent, ReactNode } from 'react'
import { Alert } from './alert'
import { Logo } from './logo'

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
      <div className="mb-8">
        <Logo size="large" />
      </div>

      <form
        noValidate
        aria-labelledby="auth-form-title"
        onSubmit={onSubmit}
        className="flex flex-col gap-5 rounded-[20px] border border-line bg-surface p-6 sm:p-8"
      >
        <div className="flex flex-col gap-1.5">
          <h1 id="auth-form-title" className="font-serif text-[34px] leading-tight tracking-tight">
            {title}
          </h1>
          <p className="text-sm text-fg-soft">{description}</p>
        </div>

        {error !== undefined && <Alert>{error}</Alert>}

        {children}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-1 flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 font-semibold text-on-accent transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-disabled disabled:text-on-disabled disabled:hover:brightness-100"
        >
          {pending && (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-on-accent/30 border-t-on-accent"
            />
          )}
          {submitLabel}
        </button>
      </form>
    </div>
  )
}
