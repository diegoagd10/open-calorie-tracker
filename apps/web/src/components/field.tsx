import type { Ref } from 'react'

type FieldProps<Name extends string> = {
  label: string
  name: Name
  type: 'text' | 'password'
  autoComplete: string
  maxLength: number
  value: string
  error: string | undefined
  // Shown under the field until an error takes its place.
  hint?: string
  disabled?: boolean
  ref?: Ref<HTMLInputElement>
  onChange: (name: Name, value: string) => void
}

export function Field<Name extends string>({
  label,
  name,
  type,
  autoComplete,
  maxLength,
  value,
  error,
  hint,
  disabled,
  ref,
  onChange,
}: FieldProps<Name>) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`
  const describedBy = error !== undefined ? errorId : hint !== undefined ? hintId : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        maxLength={maxLength}
        required
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
        className="h-11 rounded-xl border border-line-strong bg-bg px-3.5 transition-colors outline-none placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-focus disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger aria-invalid:focus:ring-danger-focus"
      />
      {error !== undefined ? (
        <p id={errorId} className="text-sm text-danger-text">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={hintId} className="text-sm text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
