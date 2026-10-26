'use client'

import {
  DAILY_GOAL_ERROR,
  type DailyGoals,
  type DailyGoalsUpdate,
  GENERIC_ERROR_MESSAGE,
  MAX_DAILY_GOAL,
  filterDailyGoalInput,
} from '@open-calorie-tracker/shared'
import { useState } from 'react'
import { Alert } from '@/components/alert'
import { GOALS } from '@/components/goals'
import { INPUT, PRIMARY_BUTTON, Section } from './section'
import { useDailyGoals } from './use-daily-goals'

type GoalKey = keyof DailyGoals

type Values = Record<GoalKey, string>

const valuesOf = (goals: DailyGoals) =>
  Object.fromEntries(GOALS.map(({ key }) => [key, String(goals[key])])) as Values

// An empty field or 0 is not a goal; leading zeros are dropped, so "070" is 70.
const goalIn = (value: string) => {
  const goal = Number(value)
  return value === '' || goal < 1 ? undefined : goal
}

// The goals the Food Log measures each day against. Save sends only the goals that changed.
export function DailyGoalsSection() {
  const { goals, failed, saving, save } = useDailyGoals()
  // What the user typed, over the saved goals. Empty until the goals load.
  const [edits, setEdits] = useState<Partial<Values>>({})
  const [saved, setSaved] = useState(false)

  const values: Partial<Values> = goals === undefined ? {} : { ...valuesOf(goals), ...edits }
  const changes: DailyGoalsUpdate = {}
  let valid = true
  for (const { key } of GOALS) {
    const goal = goalIn(values[key] ?? '')
    if (goal === undefined) valid = false
    else if (goals !== undefined && goal !== goals[key]) changes[key] = goal
  }
  const disabled = goals === undefined || saving
  const canSave = !disabled && valid && Object.keys(changes).length > 0

  const change = (key: GoalKey, value: string) => {
    setSaved(false)
    setEdits((current) => ({ ...current, [key]: filterDailyGoalInput(value) }))
  }

  const submit = async () => {
    if (!canSave) return
    if ((await save(changes)) === undefined) return
    setEdits({})
    setSaved(true)
  }

  return (
    <Section
      id="daily-goals"
      title="Daily goals"
      description="The targets the Food Log measures each day against."
    >
      <form
        aria-label="Daily goals"
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
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 p-4 sm:grid-cols-4 sm:p-5">
          {GOALS.map(({ key, label, unit, color }) => {
            const value = values[key] ?? ''
            const invalid = goals !== undefined && goalIn(value) === undefined
            return (
              <div key={key} className="flex min-w-0 flex-col gap-1.5">
                <label
                  htmlFor={`goal-${key}`}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <span aria-hidden className="size-2 rounded-full" style={{ background: color }} />
                  {label}
                </label>
                <div className="relative">
                  <input
                    id={`goal-${key}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={String(MAX_DAILY_GOAL).length}
                    disabled={disabled}
                    value={value}
                    onChange={(event) => change(key, event.target.value)}
                    aria-invalid={invalid}
                    aria-describedby={
                      invalid ? `goal-${key}-unit goal-${key}-error` : `goal-${key}-unit`
                    }
                    className={`${INPUT} pr-12 text-fg aria-invalid:border-danger`}
                  />
                  <span
                    id={`goal-${key}-unit`}
                    className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-muted"
                  >
                    {unit}
                  </span>
                </div>
                {invalid && (
                  <p id={`goal-${key}-error`} className="text-sm text-danger-text">
                    {DAILY_GOAL_ERROR}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-line p-4 sm:px-5">
          {saved && <p className="text-sm text-muted">Daily goals saved.</p>}
          <button type="submit" disabled={!canSave} className={PRIMARY_BUTTON}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Section>
  )
}
