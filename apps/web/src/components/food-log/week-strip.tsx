import { ChevronIcon } from '@/components/icons'
import { formatShortWeekday, parseDay, weekOf } from './format'
import { shiftDay } from './selected-day'

// The viewed week with its selected day highlighted.
export function WeekStrip({ date, onSelect }: { date: string; onSelect: (date: string) => void }) {
  const today = parseDay(date)

  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label="Previous week" onClick={() => onSelect(shiftDay(date, -7))}>
        <ChevronIcon direction="left" className="size-6 shrink-0 text-muted" />
      </button>
      <ol aria-label="Week" className="grid flex-1 grid-cols-7 gap-1.5 sm:gap-2">
        {weekOf(today).map((day) => {
          const isToday = day.getTime() === today.getTime()
          return (
            <li key={day.getTime()}>
              <button
                type="button"
                aria-label={day.toISOString().slice(0, 10)}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => onSelect(day.toISOString().slice(0, 10))}
                className={`flex w-full flex-col items-center rounded-xl border py-2 ${
                  isToday ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface'
                }`}
              >
                <span className="text-xs font-medium">{formatShortWeekday(day)}</span>
                <span className="text-lg font-semibold">{day.getUTCDate()}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <button type="button" aria-label="Next week" onClick={() => onSelect(shiftDay(date, 7))}>
        <ChevronIcon direction="right" className="size-6 shrink-0 text-muted" />
      </button>
    </div>
  )
}
