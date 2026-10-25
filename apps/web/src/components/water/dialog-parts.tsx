import { filterWaterAmountInput, MAX_WATER_AMOUNT } from '@open-calorie-tracker/shared'
import { type ReactNode, useId } from 'react'
import { formatNumber } from '@/components/food-log/format'
import {
  BottleIcon,
  CloseIcon,
  DropIcon,
  GlassIcon,
  JugIcon,
  MinusIcon,
  PlusIcon,
} from '@/components/icons'
import { type WaterName, canStepDown, canStepUp, stepDown, stepUp } from './water-amount'

const BUTTON =
  'flex h-12 items-center justify-center gap-2 rounded-full px-4 font-semibold whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-60'
export const SECONDARY_BUTTON = `${BUTTON} border border-line bg-bg`
export const PRIMARY_BUTTON = `${BUTTON} bg-water text-bg disabled:bg-disabled disabled:text-on-disabled disabled:opacity-100`
export const DANGER_BUTTON = `${BUTTON} bg-danger text-white`

const ICONS: Record<WaterName, (props: { className?: string }) => ReactNode> = {
  Glass: GlassIcon,
  Bottle: BottleIcon,
  Gallon: JugIcon,
  Water: DropIcon,
}

export function WaterIcon({ name, size = 'small' }: { name: WaterName; size?: 'small' | 'large' }) {
  const Icon = ICONS[name]
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl bg-water-soft text-water ${
        size === 'large' ? 'size-11' : 'size-10'
      }`}
    >
      <Icon className={size === 'large' ? 'size-6' : 'size-5'} />
    </span>
  )
}

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

// How a change moves today's water: a solid part up to the lower total and a striped part up to
// the higher one, e.g. what adding or deleting an entry would do. Decorative: the text next to it
// says the same.
export function GoalBar({
  from,
  to,
  goal,
  tone,
}: {
  from: number
  to: number
  goal: number
  tone: 'water' | 'danger'
}) {
  const percent = (value: number) => `${Math.min(100, (value / goal) * 100)}%`
  const color = tone === 'water' ? 'var(--water)' : 'var(--danger)'

  return (
    <div aria-hidden className="relative h-2 overflow-hidden rounded-full bg-track">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-water"
        style={{ width: percent(Math.min(from, to)) }}
      />
      <div
        className="absolute inset-y-0 opacity-70"
        style={{
          left: percent(Math.min(from, to)),
          width: `calc(${percent(Math.max(from, to))} - ${percent(Math.min(from, to))})`,
          backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0 4px, transparent 4px 8px)`,
        }}
      />
    </div>
  )
}

type AmountFieldProps = {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  // Shown under the field, e.g. the limits or what the change does to the total.
  note?: ReactNode
  size?: 'regular' | 'large'
}

// The amount in fl oz, with − and + buttons. Typing and pasting follow the shared rules.
export function AmountField({
  value,
  onChange,
  disabled,
  note,
  size = 'regular',
}: AmountFieldProps) {
  const noteId = useId()
  const large = size === 'large'
  const stepper =
    'flex size-12 shrink-0 items-center justify-center rounded-full border border-line bg-bg disabled:opacity-40'

  return (
    <div className={`flex flex-col gap-2 ${large ? 'items-center' : ''}`}>
      <p className="text-sm font-medium">Amount</p>
      <div className="flex w-full items-center gap-3">
        <button
          type="button"
          aria-label="Decrease amount"
          disabled={disabled || !canStepDown(value)}
          onClick={() => onChange(stepDown(value))}
          className={stepper}
        >
          <MinusIcon className="size-5" />
        </button>
        <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line-strong bg-bg px-3.5 focus-within:border-water focus-within:ring-3 focus-within:ring-water/25">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Amount (fl oz)"
            aria-describedby={note === undefined ? undefined : noteId}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(filterWaterAmountInput(value, event.target.value))}
            className={`w-full min-w-0 bg-transparent text-center font-serif outline-none ${
              large ? 'text-[40px]' : 'text-2xl'
            }`}
          />
          <span className="text-sm whitespace-nowrap text-muted">fl oz</span>
        </label>
        <button
          type="button"
          aria-label="Increase amount"
          disabled={disabled || !canStepUp(value)}
          onClick={() => onChange(stepUp(value))}
          className={stepper}
        >
          <PlusIcon className="size-5" />
        </button>
      </div>
      {note !== undefined && (
        <p id={noteId} className="text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  )
}

export const LIMITS_NOTE = `Up to ${formatNumber(MAX_WATER_AMOUNT)} fl oz, one decimal allowed.`
