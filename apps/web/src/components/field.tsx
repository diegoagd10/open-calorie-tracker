type FieldProps<Name extends string> = {
  label: string
  name: Name
  type: 'text' | 'password'
  autoComplete: string
  maxLength: number
  value: string
  error: string | undefined
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
  onChange,
}: FieldProps<Name>) {
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
        maxLength={maxLength}
        required
        value={value}
        onChange={(event) => onChange(name, event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        className="h-11 rounded-xl border border-line-strong bg-bg px-3.5 transition-colors outline-none placeholder:text-muted focus:border-accent focus:ring-3 focus:ring-focus aria-invalid:border-danger aria-invalid:focus:ring-danger-focus"
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-danger-text">
          {error}
        </p>
      )}
    </div>
  )
}
