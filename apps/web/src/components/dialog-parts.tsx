import type { ReactNode } from 'react'
import { CloseIcon } from '@/components/icons'

// Parts the log's dialogs share.

export const BUTTON =
  'flex h-12 items-center justify-center gap-2 rounded-full px-4 font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60'
export const SECONDARY_BUTTON = `${BUTTON} border border-line bg-bg`
export const DANGER_BUTTON = `${BUTTON} bg-danger text-white`

type HeaderProps = {
  titleId: string
  title: string
  subtitle: string
  icon?: ReactNode
  // Shows the × button.
  onClose?: () => void
  disabled?: boolean
}

export function DialogHeader({ titleId, title, subtitle, icon, onClose, disabled }: HeaderProps) {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id={titleId} className="font-serif text-[28px] leading-tight">
          {title}
        </h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
      {onClose !== undefined && (
        <button
          type="button"
          aria-label="Close"
          disabled={disabled}
          onClick={onClose}
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted disabled:opacity-60"
        >
          <CloseIcon className="size-5" />
        </button>
      )}
    </div>
  )
}

// How a change moves a total: a solid part up to the lower value and a striped part up to the
// higher one, e.g. what adding or deleting an entry would do. Colors are CSS colors, e.g.
// "var(--water)". Decorative: the text next to it says the same.
export function GoalBar({
  from,
  to,
  goal,
  fill,
  stripes,
}: {
  from: number
  to: number
  goal: number
  fill: string
  stripes: string
}) {
  const percent = (value: number) => `${Math.min(100, (value / goal) * 100)}%`

  return (
    <div aria-hidden className="relative h-2 overflow-hidden rounded-full bg-track">
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: percent(Math.min(from, to)), background: fill }}
      />
      <div
        className="absolute inset-y-0 opacity-70"
        style={{
          left: percent(Math.min(from, to)),
          width: `calc(${percent(Math.max(from, to))} - ${percent(Math.min(from, to))})`,
          backgroundImage: `repeating-linear-gradient(-45deg, ${stripes} 0 4px, transparent 4px 8px)`,
        }}
      />
    </div>
  )
}
