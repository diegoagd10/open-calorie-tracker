'use client'

import { useRef } from 'react'
import { Alert } from '@/components/alert'
import { GENERIC_ERROR_MESSAGE } from '@/lib/errors'
import { EntryList } from './entry-list'
import { formatLongDay, parseDay } from './format'
import { DropIcon, PlusIcon } from './icons'
import { Summary, WaterSummary } from './summary'
import { useDailyLog } from './use-daily-log'
import { usePullToRefresh } from './use-pull-to-refresh'
import { useToday } from './use-today'
import { WeekStrip } from './week-strip'

function Loader() {
  return (
    <output aria-label="Reloading" className="fixed inset-x-0 top-3 z-10 flex justify-center">
      <span className="size-8 animate-spin rounded-full border-[3px] border-[#3a3833] border-t-[#a8d08d]" />
    </output>
  )
}

// Today's food log: entries, calorie and nutrient totals and water, for the browser's day and
// time zone. On touch screens, pulling down from the top reloads it.
export function FoodLog() {
  const today = useToday()
  const { log, failed, reload } = useDailyLog(today)
  const content = useRef<HTMLDivElement>(null)
  const { showLoader } = usePullToRefresh(content, reload)

  return (
    <div className="min-h-screen bg-[#13120f] text-[#ece8e1]">
      {showLoader && <Loader />}
      <div
        ref={content}
        className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-6 sm:px-8"
      >
        <main className="flex flex-col gap-6">
          <h1 className="font-serif text-4xl tracking-tight sm:text-5xl">Food Log</h1>
          {today !== null && <WeekStrip date={today.date} />}
          {failed && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            {/* The server cannot know the browser's day, so the section waits for it. */}
            {today !== null && (
              <section
                aria-labelledby="daily-log-heading"
                className="flex min-w-0 flex-1 flex-col gap-3"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="daily-log-heading" className="text-lg font-semibold">
                    Daily log
                  </h2>
                  <p className="text-sm text-[#a19c92]">{formatLongDay(parseDay(today.date))}</p>
                </div>
                {log !== undefined && <EntryList entries={log.entries} />}
              </section>
            )}
            {log !== undefined && (
              <div className="flex flex-col gap-4 lg:w-96">
                <Summary goals={log.goals} totals={log.totals} />
                <WaterSummary goals={log.goals} totals={log.totals} />
                {/* Adding entries is not available yet. */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled
                    className="flex items-center justify-center gap-2 rounded-full border border-[#2e2c28] bg-[#1c1b18] py-3 font-semibold text-[#8fb4f0] disabled:opacity-60"
                  >
                    <DropIcon className="size-5" />
                    Add water
                  </button>
                  <button
                    type="button"
                    disabled
                    className="flex items-center justify-center gap-2 rounded-full bg-[#a8d08d] py-3 font-semibold text-[#13120f] disabled:opacity-60"
                  >
                    <PlusIcon className="size-5" />
                    Add food
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
        {today !== null && (
          <footer className="mt-auto text-xs text-[#a19c92]">
            Food Log date {today.date} · Time zone {today.timeZone}
          </footer>
        )}
      </div>
    </div>
  )
}
