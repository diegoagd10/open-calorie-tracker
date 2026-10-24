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
