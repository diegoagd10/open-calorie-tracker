'use client'

import {
  GENERIC_ERROR_MESSAGE,
  WEIGHT_RANGE_ERROR,
  type WeightHistory,
  filterWeightInput,
  weightSchema,
} from '@open-calorie-tracker/shared'
import confetti from 'canvas-confetti'
import Link from 'next/link'
import { useState } from 'react'
import { Alert } from '@/components/alert'
import { AppHeader, FoodLogLink, SettingsLink, WeightLink } from '@/components/app-header'
import { formatNumber, formatShortDay, parseDay } from '@/components/food-log/format'
import { useToday } from '@/components/food-log/use-today'
import { useLogOut } from '@/components/use-log-out'
import { WeightChart } from './weight-chart'
import { useWeightHistory } from './use-weight-history'

const PERIODS = [
  { name: '30D', days: 30 },
  { name: '90D', days: 90 },
  { name: '1Y', days: 365 },
  { name: 'All', days: undefined },
] as const

type Period = (typeof PERIODS)[number]

const CARD = 'rounded-[20px] border border-line bg-surface'

const weightIn = (value: string) => {
  const parsed = weightSchema.safeParse(Number(value))
  return value === '' || !parsed.success ? undefined : parsed.data
}

const pounds = (value: number | null) => (value === null ? '—' : `${formatNumber(value)} lb`)

// The weigh-ins of the last `days` days up to today, both included, or every one.
const inPeriod = (entries: WeightHistory['entries'], today: string, { days }: Period) => {
  if (days === undefined) return entries
  const since = parseDay(today)
  since.setUTCDate(since.getUTCDate() - (days - 1))
  const from = since.toISOString().slice(0, 10)
  return entries.filter(({ date }) => date >= from)
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <fieldset aria-label={label} className={`${CARD} m-0 flex min-w-0 flex-col gap-1 p-3`}>
      <p className="text-xs text-fg-soft">{label}</p>
      <p className="font-semibold">{value}</p>
    </fieldset>
  )
}

function Empty({ title, children }: { title: string; children: string }) {
  return (
    <div className="flex h-44 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-4 text-center text-sm text-muted">
      <p className="font-semibold text-fg">{title}</p>
      <p>{children}</p>
    </div>
  )
}

// Logs today's weight, and shows the progress towards the weight goal and a chart of the
// weigh-ins. Only today's weight can be logged here; past days come from the API.
export function Weight() {
  const logOut = useLogOut()
  const today = useToday()
  const { history, failed, saving, log } = useWeightHistory()
  // What the user typed, over the last weigh-in.
  const [typed, setTyped] = useState<string>()
  const [period, setPeriod] = useState<Period>(PERIODS[1])

  const entries = history?.entries ?? []
  const last = entries.at(-1)
  const savedToday = last !== undefined && last.date === today?.date ? last : undefined
  const value = typed ?? (last === undefined ? '' : String(last.weight))
  const weight = weightIn(value)
  const goal = history?.goal ?? null
  const stats = history?.stats
  const canSave =
    history !== undefined &&
    today !== null &&
    !saving &&
    weight !== undefined &&
    weight !== savedToday?.weight

  const submit = async () => {
    if (!canSave) return
    const previous = last?.weight ?? goal?.startWeight
    if (!(await log(weight, today.timeZone))) return
    // Only when this weigh-in crosses the goal, not on every one under it.
    if (goal !== null && previous !== undefined && previous > goal.goalWeight) {
      if (weight <= goal.goalWeight) {
        void confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          disableForReducedMotion: true,
        })
      }
    }
  }

  const visible = today === null ? entries : inPeriod(entries, today.date, period)

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppHeader logOut={logOut}>
        <FoodLogLink />
        <WeightLink current />
        <SettingsLink />
      </AppHeader>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-8">
        <h1 className="font-serif text-[40px] leading-none tracking-tight sm:text-5xl">Weight</h1>
        {(failed || logOut.failed) && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
        <form
          aria-label="Today's weight"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className={`${CARD} flex flex-col gap-2 p-4 sm:p-5`}
        >
          <label htmlFor="weight" className="text-sm font-medium">
            Today&apos;s weight
          </label>
          <div className="flex gap-3">
            <div className="relative min-w-0 flex-1">
              <input
                id="weight"
                type="text"
                inputMode="decimal"
                placeholder="Today's weight"
                disabled={history === undefined}
                value={value}
                onChange={(event) => setTyped(filterWeightInput(value, event.target.value))}
                aria-invalid={value !== '' && weight === undefined}
                className="h-11 w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 pr-10 text-fg aria-invalid:border-danger disabled:cursor-not-allowed"
              />
              <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-xs text-muted">
                lb
              </span>
            </div>
            <button
              type="submit"
              disabled={!canSave}
              className="flex h-11 items-center rounded-full bg-accent px-5 text-sm font-semibold text-on-accent disabled:bg-disabled disabled:text-on-disabled"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {value !== '' && weight === undefined && (
            <p className="text-sm text-danger-text">{WEIGHT_RANGE_ERROR}</p>
          )}
          {savedToday !== undefined ? (
            <p className="text-sm text-muted">Saved today</p>
          ) : (
            last !== undefined && (
              <p className="text-sm text-muted">
                Last weigh-in: {formatShortDay(parseDay(last.date))}
              </p>
            )
          )}
        </form>
        {history !== undefined && (
          <>
            {goal === null ? (
              <p className="text-sm text-muted">
                Set your starting and goal weight in{' '}
                <Link
                  href="/settings#weight-goal-heading"
                  className="font-semibold text-accent-text underline"
                >
                  Settings
                </Link>{' '}
                to see your progress.
              </p>
            ) : (
              stats?.toGo === 0 && (
                <p className="text-sm font-semibold text-accent-text">Goal reached</p>
              )
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Current" value={pounds(stats?.current ?? null)} />
              <Tile label="Lost" value={pounds(stats?.lost ?? null)} />
              <Tile label="To go" value={pounds(stats?.toGo ?? null)} />
              <Tile
                label="Progress"
                value={goal === null ? '—' : `${formatNumber(stats?.progress ?? 0)}%`}
              />
            </div>
            <section aria-label="Chart" className={`${CARD} flex flex-col gap-4 p-4 sm:p-5`}>
              {entries.length === 0 && (
                <Empty title="No weigh-ins yet">Log your weight to start your chart.</Empty>
              )}
              {entries.length === 1 && (
                <Empty title="Your chart starts tomorrow">
                  Log your weight again on another day to see your trend.
                </Empty>
              )}
              {entries.length > 1 && (
                <>
                  <div role="radiogroup" aria-label="Period" className="flex gap-1 self-end">
                    {PERIODS.map((option) => (
                      <button
                        key={option.name}
                        type="button"
                        // Pills that behave as radio buttons; native radios would need hidden inputs.
                        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
                        role="radio"
                        aria-checked={option === period}
                        onClick={() => setPeriod(option)}
                        className="rounded-full border border-line px-3 py-1 text-xs text-muted aria-checked:border-transparent aria-checked:bg-surface-selected aria-checked:text-fg"
                      >
                        {option.name}
                      </button>
                    ))}
                  </div>
                  {visible.length === 0 ? (
                    <Empty title="No weigh-ins in this period">
                      Pick a longer period to see your chart.
                    </Empty>
                  ) : (
                    <WeightChart entries={visible} goal={goal} />
                  )}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}
