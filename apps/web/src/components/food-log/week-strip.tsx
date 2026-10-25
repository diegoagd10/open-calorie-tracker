import { ChevronIcon } from './icons'
import { formatShortWeekday, parseDay, weekOf } from './format'

// The current week with today highlighted. Navigating between days is not available yet, so the
// arrows and days are not interactive.
export function WeekStrip({ date }: { date: string }) {
  const today = parseDay(date)

  return (
    <div className="flex items-center gap-2">
      <ChevronIcon direction="left" className="size-6 shrink-0 text-muted" />
      <ol aria-label="Week" className="grid flex-1 grid-cols-7 gap-1.5 sm:gap-2">
        {weekOf(today).map((day) => {
          const isToday = day.getTime() === today.getTime()
          return (
            <li
              key={day.getTime()}
              aria-current={isToday ? 'date' : undefined}
              className={`flex flex-col items-center rounded-xl border py-2 ${
                isToday ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface'
              }`}
            >
              <span className="text-xs font-medium">{formatShortWeekday(day)}</span>
              <span className="text-lg font-semibold">{day.getUTCDate()}</span>
            </li>
          )
        })}
      </ol>
      <ChevronIcon direction="right" className="size-6 shrink-0 text-muted" />
    </div>
  )
}
