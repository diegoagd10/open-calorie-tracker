'use client'

import {
  GENERIC_ERROR_MESSAGE,
  WEIGHT_GOAL_ORDER_ERROR,
  WEIGHT_RANGE_ERROR,
  type WeightGoal,
  filterWeightInput,
  weightSchema,
} from '@open-calorie-tracker/shared'
import { useState } from 'react'
import { Alert } from '@/components/alert'
import { useToday } from '@/components/food-log/use-today'
import { INPUT, PRIMARY_BUTTON, Section } from './section'
import { useWeightGoal } from './use-weight-goal'

type Field = 'startWeight' | 'goalWeight'

const FIELDS: { key: Field; label: string }[] = [
  { key: 'startWeight', label: 'Starting weight' },
  { key: 'goalWeight', label: 'Goal weight' },
]

type Values = Record<Field, string>

const valuesOf = (goal: WeightGoal | null): Values =>
  goal === null
    ? { startWeight: '', goalWeight: '' }
    : { startWeight: String(goal.startWeight), goalWeight: String(goal.goalWeight) }

const weightIn = (value: string) => {
  const parsed = weightSchema.safeParse(Number(value))
  return value === '' || !parsed.success ? undefined : parsed.data
}

// The weight the Weight page measures progress against, from a starting weight down to a goal.
export function WeightGoalSection() {
  const { goal, failed, saving, save } = useWeightGoal()
  const today = useToday()
  // What the user typed, over the saved goal. Empty until the goal loads.
  const [edits, setEdits] = useState<Partial<Values>>({})
  const [saved, setSaved] = useState(false)

  const values: Values = { ...valuesOf(goal ?? null), ...edits }
  const startWeight = weightIn(values.startWeight)
  const goalWeight = weightIn(values.goalWeight)
  const errors: Partial<Record<Field, string>> = {}
  for (const { key } of FIELDS) {
    if (values[key] !== '' && weightIn(values[key]) === undefined) errors[key] = WEIGHT_RANGE_ERROR
  }
  if (startWeight !== undefined && goalWeight !== undefined && goalWeight >= startWeight) {
    errors.goalWeight = WEIGHT_GOAL_ORDER_ERROR
  }
  const changed =
    goal === null ||
    goal === undefined ||
    startWeight !== goal.startWeight ||
    goalWeight !== goal.goalWeight
  const disabled = goal === undefined || saving
  const canSave =
    !disabled &&
    today !== null &&
    startWeight !== undefined &&
    goalWeight !== undefined &&
    Object.keys(errors).length === 0 &&
    changed

  const change = (key: Field, value: string) => {
    setSaved(false)
    setEdits((current) => ({ ...current, [key]: filterWeightInput(values[key], value) }))
  }

  const submit = async () => {
    if (!canSave) return
    if ((await save({ startWeight, goalWeight, date: today.date })) === undefined) return
    setEdits({})
    setSaved(true)
  }

  return (
    <Section
      id="weight-goal"
      title="Weight goal"
      description="Where your weight starts and where you want it to be."
    >
      <form
        aria-label="Weight goal"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {failed && (
          <div className="px-4 pt-4 sm:px-5">
            <Alert>{GENERIC_ERROR_MESSAGE}</Alert>
          </div>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-4 sm:p-5">
          {FIELDS.map(({ key, label }) => {
            const error = errors[key]
            return (
              <div key={key} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={key} className="text-sm font-medium">
                  {label}
                </label>
                <div className="relative">
                  <input
                    id={key}
                    type="text"
                    inputMode="decimal"
                    disabled={disabled}
                    value={values[key]}
                    onChange={(event) => change(key, event.target.value)}
                    aria-invalid={error !== undefined}
                    aria-describedby={
                      error === undefined ? `${key}-unit` : `${key}-unit ${key}-error`
                    }
                    className={`${INPUT} pr-10 text-fg aria-invalid:border-danger`}
                  />
                  <span
                    id={`${key}-unit`}
                    className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-muted"
                  >
                    lb
                  </span>
                </div>
                {error !== undefined && (
                  <p id={`${key}-error`} className="text-sm text-danger-text">
                    {error}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line p-4 sm:px-5">
          {saved && <p className="text-sm text-muted">Weight goal saved.</p>}
          <button type="submit" disabled={!canSave} className={PRIMARY_BUTTON}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Section>
  )
}
