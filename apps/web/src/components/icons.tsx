// Small inline icons, so the page needs no icon library.

import type { ReactNode } from 'react'

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

export function GearIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

export function KeyIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="7.5" cy="16.5" r="3.5" />
      <path d="M10 14l9-9m-3 3 2.5 2.5M14 10l2 2" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </svg>
  )
}

// The outline icons below share one look: 24px grid, round 1.8px strokes, hidden from assistive
// technology because a text label always sits next to them.
function OutlineIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  )
}

export function GlassIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M6 4h12l-1.5 16h-9L6 4Z" />
      <path d="M7 10h10" />
    </OutlineIcon>
  )
}

export function BottleIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M10 3h4M10.5 3v3.5L8.5 9.5V20a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V9.5l-2-3V3" />
      <path d="M8.5 13h7" />
    </OutlineIcon>
  )
}

export function JugIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M8 3h6M9 3v3L6 9v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9l-3-3V3" />
      <path d="M17 11h1.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5H17M6 13h11" />
    </OutlineIcon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
    </OutlineIcon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </OutlineIcon>
  )
}

export function MinusIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M5 12h14" />
    </OutlineIcon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <OutlineIcon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </OutlineIcon>
  )
}
