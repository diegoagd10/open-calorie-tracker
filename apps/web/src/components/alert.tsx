import type { ReactNode } from 'react'

export function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2.5 text-sm text-danger-text"
    >
      {children}
    </p>
  )
}
