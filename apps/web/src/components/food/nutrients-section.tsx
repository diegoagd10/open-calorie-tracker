import { type Nutrient, filterPerServingInput } from '@open-calorie-tracker/shared'
import { useId, useState } from 'react'
import { ChevronIcon } from '@/components/icons'

export const NUTRIENT_FIELDS: { key: Nutrient; label: string; unit: string; color: string }[] = [
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--protein)' },
  { key: 'carbohydrate', label: 'Carbohydrate', unit: 'g', color: 'var(--carbohydrate)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--fat)' },
  { key: 'fiber', label: 'Fiber', unit: 'g', color: 'var(--fiber)' },
  { key: 'sugar', label: 'Sugar', unit: 'g', color: 'var(--sugar)' },
  { key: 'sodium', label: 'Sodium', unit: 'mg', color: 'var(--sodium)' },
]

// What each nutrient field holds; empty when the label doesn't say.
export type NutrientValues = Record<Nutrient, string>

export const NO_NUTRIENTS: NutrientValues = {
  protein: '',
  carbohydrate: '',
  fat: '',
  fiber: '',
  sugar: '',
  sodium: '',
}

type NutrientsSectionProps = {
  values: NutrientValues
  onChange: (values: NutrientValues) => void
  disabled: boolean
}

// Optional nutrients per serving, collapsed until the user opens them. They keep their values
// while collapsed.
export function NutrientsSection({ values, onChange, disabled }: NutrientsSectionProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const filled = NUTRIENT_FIELDS.filter(({ key }) => values[key] !== '').length

  return (
    <div className="rounded-2xl border border-line bg-bg">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        className="flex min-h-13 w-full items-center gap-2.5 px-3.5 text-left"
      >
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] font-semibold">Nutrients</span>
          <span className="text-xs text-muted">
            {filled === 0
              ? 'Optional · protein, carbs, fat and more'
              : `${filled} of ${NUTRIENT_FIELDS.length} added`}
          </span>
        </span>
        <span aria-hidden className="flex gap-1">
          {NUTRIENT_FIELDS.slice(0, 3).map(({ key, color }) => (
            <span key={key} className="size-2 rounded-full" style={{ background: color }} />
          ))}
        </span>
        <ChevronIcon direction={open ? 'down' : 'right'} className="size-4 shrink-0 text-muted" />
      </button>
      {open && (
        <div id={contentId} className="grid grid-cols-2 gap-2.5 px-3.5 pt-1 pb-3.5">
          {NUTRIENT_FIELDS.map(({ key, label, unit, color }) => (
            <label key={key} className="flex flex-col gap-1 text-xs text-fg-soft">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
              <span className="flex h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-surface px-3">
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="—"
                  aria-label={`${label} ${unit}`}
                  disabled={disabled}
                  value={values[key]}
                  onChange={(event) =>
                    onChange({
                      ...values,
                      [key]: filterPerServingInput(values[key], event.target.value),
                    })
                  }
                  className="w-full min-w-0 bg-transparent text-base text-fg outline-none"
                />
                <span className="text-muted">{unit}</span>
              </span>
            </label>
          ))}
          <p className="col-span-2 text-xs text-muted">
            Per serving. Leave blank when the label doesn&apos;t say.
          </p>
        </div>
      )}
    </div>
  )
}
