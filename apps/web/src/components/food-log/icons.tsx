// Small inline icons, so the page needs no icon library.

type IconProps = { label?: string; className?: string }

const a11y = (label: string | undefined) =>
  label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }

export function ForkKnifeIcon({ label, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
      {...a11y(label)}
    >
      <path d="M7 3v8m-2.5-8v5.5a2.5 2.5 0 0 0 5 0V3M7 11v10M16.5 3c-1.7 1.2-2.5 3.4-2.5 6v3h2.5m0-9v18" />
    </svg>
  )
}

export function DropIcon({ label, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      className={className}
      {...a11y(label)}
    >
      <path d="M12 3.5c3 3.6 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.9 6-10.5Z" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function ChevronIcon({ direction, className }: IconProps & { direction: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}
