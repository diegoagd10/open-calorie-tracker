import type { DailyGoals, DailyTotals } from '@open-calorie-tracker/shared'
import { NUTRIENT_GOALS } from '@/components/goals'
import { ChevronIcon } from '@/components/icons'
import { formatNumber } from './format'
import { ProgressBar } from './progress-bar'

// A fieldset is the native group element; these hold figures, not form controls.
const GROUP = 'm-0 min-w-0 border-0'

const foodEntriesLabel = (count: number) => {
  if (count === 0) return 'No Food Entries'
  return count === 1 ? '1 Food Entry' : `${formatNumber(count)} Food Entries`
}

type SummaryProps = { goals: DailyGoals; totals: DailyTotals }

export function Summary({ goals, totals }: SummaryProps) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <fieldset aria-label="Calories" className={`${GROUP} flex flex-col gap-3 p-5`}>
        <p className="text-sm text-fg-soft">Calories</p>
        <p className="flex items-baseline gap-2">
          <span className="font-serif text-5xl leading-none">{formatNumber(totals.calories)}</span>
          <span className="text-sm text-muted">/ {formatNumber(goals.calories)} kcal</span>
        </p>
        <ProgressBar
          label="Calories"
          value={totals.calories}
          goal={goals.calories}
          color="var(--accent)"
          className="h-2.5"
        />
        <p className="text-sm text-muted">{foodEntriesLabel(totals.foodEntries)}</p>
      </fieldset>
      <div className="grid grid-cols-3 border-t border-line">
        {NUTRIENT_GOALS.map(({ key, label, unit, color }, index) => (
          <fieldset
            key={key}
            aria-label={label}
            className={`${GROUP} flex flex-col gap-1 p-3 ${index % 3 === 0 ? '' : 'border-l border-line'} ${
              index >= 3 ? 'border-t border-line' : ''
            }`}
          >
            <p className="text-xs text-fg-soft">{label}</p>
            <p className="font-semibold">{formatNumber(totals[key])}</p>
            <p className="text-xs text-muted">
              / {formatNumber(goals[key])} {unit}
            </p>
            <ProgressBar
              label={label}
              value={totals[key]}
              goal={goals[key]}
              color={color}
              className="mt-1 h-1"
            />
          </fieldset>
        ))}
      </div>
    </div>
  )
}

export function WaterSummary({ goals, totals }: SummaryProps) {
  return (
    <fieldset
      aria-label="Water"
      className={`${GROUP} flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Water</p>
        <p className="flex items-center gap-1 text-sm">
          <span className="font-semibold">{formatNumber(totals.water)} fl oz</span>
          <span className="text-muted">/ {formatNumber(goals.water)} fl oz</span>
          <ChevronIcon direction="right" className="size-4 text-muted" />
        </p>
      </div>
      <ProgressBar
        label="Water"
        value={totals.water}
        goal={goals.water}
        color="var(--water)"
        className="h-2"
      />
    </fieldset>
  )
}
