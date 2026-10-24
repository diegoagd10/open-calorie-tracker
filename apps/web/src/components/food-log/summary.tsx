import type { DailyGoals, DailyTotals, Nutrient } from '@open-calorie-tracker/shared'
import { formatNumber } from './format'
import { ChevronIcon } from './icons'
import { ProgressBar } from './progress-bar'

const NUTRIENTS: { key: Nutrient; label: string; unit: string; color: string }[] = [
  { key: 'protein', label: 'Protein', unit: 'g', color: '#e8826b' },
  { key: 'carbohydrate', label: 'Carbohydrate', unit: 'g', color: '#f2cf7a' },
  { key: 'fat', label: 'Fat', unit: 'g', color: '#7aa2e8' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: '#8fb4f0' },
  { key: 'sugar', label: 'Sugar max', unit: 'g', color: '#c9a7ef' },
  { key: 'sodium', label: 'Sodium max', unit: 'mg', color: '#9fd3c7' },
]

// A fieldset is the native group element; these hold figures, not form controls.
const GROUP = 'm-0 min-w-0 border-0'

const foodEntriesLabel = (count: number) => {
  if (count === 0) return 'No Food Entries'
  return count === 1 ? '1 Food Entry' : `${formatNumber(count)} Food Entries`
}

type SummaryProps = { goals: DailyGoals; totals: DailyTotals }

export function Summary({ goals, totals }: SummaryProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#2e2c28] bg-[#1c1b18]">
      <fieldset aria-label="Calories" className={`${GROUP} flex flex-col gap-3 p-5`}>
        <p className="text-sm text-[#cfcac0]">Calories</p>
        <p className="flex items-baseline gap-2">
          <span className="font-serif text-5xl text-[#ece8e1]">
            {formatNumber(totals.calories)}
          </span>
          <span className="text-sm text-[#a19c92]">/ {formatNumber(goals.calories)} kcal</span>
        </p>
        <ProgressBar
          label="Calories"
          value={totals.calories}
          goal={goals.calories}
          color="#a8d08d"
          className="h-2.5"
        />
        <p className="text-sm text-[#a19c92]">{foodEntriesLabel(totals.foodEntries)}</p>
      </fieldset>
      <div className="grid grid-cols-3 border-t border-[#2e2c28]">
        {NUTRIENTS.map(({ key, label, unit, color }, index) => (
          <fieldset
            key={key}
            aria-label={label}
            className={`${GROUP} flex flex-col gap-1 p-3 ${index % 3 === 0 ? '' : 'border-l border-[#2e2c28]'} ${
              index >= 3 ? 'border-t border-[#2e2c28]' : ''
            }`}
          >
            <p className="text-xs text-[#cfcac0]">{label}</p>
            <p className="font-semibold text-[#ece8e1]">{formatNumber(totals[key])}</p>
            <p className="text-xs text-[#a19c92]">
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
      className={`${GROUP} flex flex-col gap-4 rounded-2xl border border-[#2e2c28] bg-[#1c1b18] p-5`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#ece8e1]">Water</p>
        <p className="flex items-center gap-1 text-sm">
          <span className="font-semibold text-[#ece8e1]">{formatNumber(totals.water)} fl oz</span>
          <span className="text-[#a19c92]">/ {formatNumber(goals.water)} fl oz</span>
          <ChevronIcon direction="right" className="size-4 text-[#ece8e1]" />
        </p>
      </div>
      <ProgressBar
        label="Water"
        value={totals.water}
        goal={goals.water}
        color="#8fb4f0"
        className="h-2"
      />
    </fieldset>
  )
}
