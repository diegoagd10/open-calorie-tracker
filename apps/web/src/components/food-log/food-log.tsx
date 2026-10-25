'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { Alert } from '@/components/alert'
import { AppHeader } from '@/components/app-header'
import { DropIcon, GearIcon, PlusIcon } from '@/components/icons'
import { useLogOut } from '@/components/use-log-out'
import { useWaterDialogs } from '@/components/water/use-water-dialogs'
import { GENERIC_ERROR_MESSAGE } from '@open-calorie-tracker/shared'
import { EntryList } from './entry-list'
import { formatLongDay, parseDay } from './format'
import { Summary, WaterSummary } from './summary'
import { useDailyLog } from './use-daily-log'
import { usePullToRefresh } from './use-pull-to-refresh'
import { useToday } from './use-today'
import { WeekStrip } from './week-strip'

function Loader() {
  return (
    <output aria-label="Reloading" className="fixed inset-x-0 top-3 z-10 flex justify-center">
      <span className="size-8 animate-spin rounded-full border-[3px] border-line-strong border-t-accent" />
    </output>
  )
}

// Adding food is not available yet. On small screens the buttons stay at the bottom of the screen
// while the log scrolls.
function AddButtons({ onAddWater }: { onAddWater: () => void }) {
  return (
    <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-3 border-t border-line bg-bg px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:-mx-8 sm:px-8 lg:static lg:col-start-2 lg:row-start-2 lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
      <button
        type="button"
        onClick={onAddWater}
        className="flex h-12 items-center justify-center gap-2 rounded-full border border-line bg-surface font-semibold disabled:opacity-60"
      >
        <DropIcon className="size-5 text-water" />
        Add water
      </button>
      <button
        type="button"
        disabled
        className="flex h-12 items-center justify-center gap-2 rounded-full bg-accent font-semibold text-on-accent disabled:opacity-60"
      >
        <PlusIcon className="size-5" />
        Add food
      </button>
    </div>
  )
}

// Today's food log: entries, calorie and nutrient totals and water, for the browser's day and
// time zone. On touch screens, pulling down from the top reloads it.
export function FoodLog() {
  const today = useToday()
  const { log, failed, reload } = useDailyLog(today)
  const content = useRef<HTMLDivElement>(null)
  const { showLoader } = usePullToRefresh(content, reload)
  const logOut = useLogOut()
  const water = useWaterDialogs(() => void reload())

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {showLoader && <Loader />}
      <AppHeader logOut={logOut}>
        <Link
          href="/settings"
          aria-label="Settings"
          className="flex size-9 items-center justify-center rounded-full border border-line bg-surface text-fg-soft"
        >
          <GearIcon className="size-[18px]" />
        </Link>
      </AppHeader>
      <div
        ref={content}
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 pt-6 sm:px-8 sm:pt-8"
      >
        <main className="flex flex-col gap-6">
          <h1 className="font-serif text-[40px] leading-none tracking-tight sm:text-5xl">
            Food Log
          </h1>
          {today !== null && <WeekStrip date={today.date} />}
          {(failed || logOut.failed) && <Alert>{GENERIC_ERROR_MESSAGE}</Alert>}
          {/* Small screens stack the totals above the log; wide ones put them beside it. */}
          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
            {log !== undefined && (
              <div className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
                <Summary goals={log.goals} totals={log.totals} />
                <WaterSummary goals={log.goals} totals={log.totals} />
              </div>
            )}
            {/* The server cannot know the browser's day, so the section waits for it. */}
            {today !== null && (
              <section
                aria-labelledby="daily-log-heading"
                className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-span-2 lg:row-start-1"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id="daily-log-heading" className="text-lg font-semibold">
                    Daily log
                  </h2>
                  <p className="text-sm text-muted">{formatLongDay(parseDay(today.date))}</p>
                </div>
                {log !== undefined && <EntryList entries={log.entries} onOpenWater={water.edit} />}
              </section>
            )}
            {log !== undefined && <AddButtons onAddWater={water.add} />}
          </div>
        </main>
        {today !== null && (
          <footer className="mt-auto border-t border-line py-4 text-xs text-muted">
            Food Log date {today.date} · Time zone {today.timeZone}
          </footer>
        )}
      </div>
      {water.dialogs}
    </div>
  )
}
