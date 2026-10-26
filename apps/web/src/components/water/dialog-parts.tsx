import { filterWaterAmountInput, MAX_WATER_AMOUNT } from '@open-calorie-tracker/shared'
import { type ReactNode, useId } from 'react'
import { formatNumber } from '@/components/food-log/format'
import { BUTTON } from '@/components/dialog-parts'
import { BottleIcon, DropIcon, GlassIcon, JugIcon, MinusIcon, PlusIcon } from '@/components/icons'
import { type WaterName, canStepDown, canStepUp, stepDown, stepUp } from './water-amount'

export const PRIMARY_BUTTON = `${BUTTON} bg-water text-bg disabled:bg-disabled disabled:text-on-disabled disabled:opacity-100`

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
