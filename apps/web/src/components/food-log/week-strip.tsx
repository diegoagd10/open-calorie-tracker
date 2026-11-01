import { type TouchEvent, useEffect, useRef, useState } from 'react'
import { ChevronIcon, ReturnIcon } from '@/components/icons'
import { formatNumber, formatShortDay, formatShortWeekday, parseDay, weekOf } from './format'
import { shiftDay } from './selected-day'
import type { WeekSummaries } from './use-daily-summaries'

// From this share of the calorie goal up to all of it, a day is on target.
const ON_TARGET = 0.9
// How far a finger has to travel sideways before the strip turns to the next week.
const SWIPE_PX = 60
// How far a finger moves before the gesture counts as sideways or as a scroll.
const AXIS_LOCK_PX = 6
const SLIDE_MS = 260
const SLIDE_TRANSITION = `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`

const isoDay = (day: Date) => day.toISOString().slice(0, 10)

const mondayOf = (date: string) => isoDay(weekOf(parseDay(date))[0] ?? parseDay(date))

const RELATIVE_WEEKS: Record<number, string> = { [-1]: 'Last week', 0: 'This week', 1: 'Next week' }

// "Oct 19 – Oct 25 · This week".
export const weekLabel = (date: string, today: string) => {
  const week = weekOf(parseDay(date))
  const [monday, sunday] = [week[0], week[6]]
  if (monday === undefined || sunday === undefined) return ''
  const weeks = Math.round(
    (monday.getTime() - parseDay(mondayOf(today)).getTime()) / (7 * 24 * 60 * 60 * 1000),
  )
  const relative = RELATIVE_WEEKS[weeks]
  const range = `${formatShortDay(monday)} – ${formatShortDay(sunday)}`
  return relative === undefined ? range : `${range} · ${relative}`
}

type Status = 'under' | 'on' | 'over' | 'none' | 'future'

type Progress = { status: Status; description: string; ratio: number }

// How a day went against the calorie goal, or undefined while its summary loads.
const progressOf = (
  date: string,
  today: string,
  summaries: WeekSummaries | undefined,
): Progress | undefined => {
  const summary = summaries?.days[date]
  if (summary === undefined || summary.foodEntries === 0) {
    if (date > today) return { status: 'future', description: 'Upcoming', ratio: 0 }
    return summary && { status: 'none', description: 'Nothing logged', ratio: 0 }
  }
  const goal = summaries?.calorieGoal ?? 0
  const ratio = goal > 0 ? summary.calories / goal : 1
  return {
    status: ratio > 1 ? 'over' : ratio >= ON_TARGET ? 'on' : 'under',
    description: `${formatNumber(summary.calories)} of ${formatNumber(goal)} kcal`,
    ratio,
  }
}

// Fills clockwise from the top with what the day's food adds up to; red past the goal, and a
// dashed track when nothing was logged.
function Ring({ progress }: { progress: Progress | undefined }) {
  const circle = { cx: 24, cy: 24, r: 20, fill: 'none', strokeWidth: 4, pathLength: 100 }
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="absolute inset-0 size-full -rotate-90">
      <circle
        {...circle}
        className="stroke-line-strong"
        strokeDasharray={progress?.status === 'none' ? '3.2 4.1' : undefined}
      />
      {progress !== undefined && progress.ratio > 0 && (
        <circle
          {...circle}
          stroke={progress.status === 'over' ? 'var(--danger)' : 'var(--accent)'}
          strokeLinecap="round"
          strokeDasharray={`${Math.min(progress.ratio, 1) * 100} 100`}
        />
      )}
    </svg>
  )
}

type DayProps = {
  day: Date
  selected: boolean
  today: string
  summaries: WeekSummaries | undefined
  onSelect: (date: string) => void
}

function Day({ day, selected, today, summaries, onSelect }: DayProps) {
  const date = isoDay(day)
  const isToday = date === today
  const progress = progressOf(date, today, summaries)
  const description = [isToday ? 'Today' : undefined, progress?.description]
    .filter((part) => part !== undefined)
    .join(', ')

  return (
    <button
      type="button"
      aria-label={date}
      aria-current={selected ? 'date' : undefined}
      // A global attribute since ARIA 1.3, which the rule predates.
      // oxlint-disable-next-line jsx-a11y/role-supports-aria-props
      aria-description={description === '' ? undefined : description}
      data-status={progress?.status}
      onClick={() => onSelect(date)}
      className={`flex w-full flex-col items-center gap-1 rounded-xl border-[1.5px] pt-2 pb-1.5 sm:gap-2 sm:rounded-2xl sm:pt-3.5 sm:pb-2.5 ${
        selected ? 'border-accent bg-surface-selected' : 'border-line bg-surface'
      } ${progress?.status === 'future' ? 'opacity-45' : ''}`}
    >
      <span
        className={`text-[11px] font-medium sm:text-[13px] ${isToday ? 'text-accent-text' : 'text-muted'}`}
      >
        {formatShortWeekday(day)}
      </span>
      <span className="relative flex size-8 items-center justify-center sm:size-12">
        <Ring progress={progress} />
        <span
          className={`relative text-sm font-semibold sm:text-lg ${isToday ? 'text-accent-text' : ''}`}
        >
          {day.getUTCDate()}
        </span>
      </span>
      <span
        aria-hidden
        className={`size-[5px] rounded-full sm:size-1.5 ${isToday ? 'bg-accent' : ''}`}
      />
    </button>
  )
}

type WeekProps = {
  // The selected day, YYYY-MM-DD.
  date: string
  today: string
  onSelect: (date: string) => void
}

// Back to today, shown only away from it, and, on wide screens, the previous and next weeks.
export function WeekControls({ date, today, onSelect }: WeekProps) {
  const arrow =
    'flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-soft'
  return (
    <div className="flex items-center gap-2">
      {date !== today && (
        <button
          type="button"
          onClick={() => onSelect(today)}
          className="flex h-9 items-center gap-1.5 rounded-full border border-accent px-3.5 text-sm font-semibold text-accent-text sm:h-10 sm:px-4"
        >
          <ReturnIcon className="size-4" />
          Today
        </button>
      )}
      {/* Phones turn the week with a swipe instead. */}
      <div className="hidden items-center gap-2 sm:flex">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => onSelect(shiftDay(date, -7))}
          className={arrow}
        >
          <ChevronIcon direction="left" className="size-[18px]" />
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => onSelect(shiftDay(date, 7))}
          className={arrow}
        >
          <ChevronIcon direction="right" className="size-[18px]" />
        </button>
      </div>
    </div>
  )
}

type Gesture = { x: number; y: number; dx: number; width: number; axis?: 'x' | 'y' }

// The viewed week, each day with how it went. On touch screens a sideways swipe drags the
// neighbouring week into view and, past SWIPE_PX, selects the same weekday in it.
export function WeekStrip({
  date,
  today,
  summaries,
  onSelect,
}: WeekProps & { summaries: WeekSummaries | undefined }) {
  const [offset, setOffset] = useState({ px: 0, animate: false })
  const strip = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture>(undefined)
  const turn = useRef<ReturnType<typeof setTimeout>>(undefined)
  const monday = parseDay(mondayOf(date))

  useEffect(() => () => clearTimeout(turn.current), [])

  // Not passive, so a sideways swipe stops the browser from scrolling: it would otherwise treat the
  // next tap as stopping that scroll rather than as a click.
  useEffect(() => {
    const element = strip.current
    if (element === null) return
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const current = gesture.current
      const touch = event.touches[0]
      if (current === undefined || touch === undefined) return
      const dx = touch.clientX - current.x
      const dy = touch.clientY - current.y
      if (current.axis === undefined && Math.max(Math.abs(dx), Math.abs(dy)) > AXIS_LOCK_PX) {
        current.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      }
      if (current.axis !== 'x') return
      event.preventDefault()
      current.dx = dx
      setOffset({ px: dx, animate: false })
    }
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => element.removeEventListener('touchmove', onTouchMove)
  }, [])

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (event.touches.length !== 1 || touch === undefined || turn.current !== undefined) return
    const width = event.currentTarget.offsetWidth
    gesture.current = { x: touch.clientX, y: touch.clientY, dx: 0, width }
  }

  const onTouchEnd = () => {
    const current = gesture.current
    gesture.current = undefined
    if (current?.axis !== 'x') return
    // A finger moving left brings in the next week; moving right, the previous one.
    const weeks = current.dx < -SWIPE_PX ? 1 : current.dx > SWIPE_PX ? -1 : 0
    setOffset({ px: -weeks * current.width, animate: true })
    if (weeks !== 0) {
      turn.current = setTimeout(() => {
        turn.current = undefined
        onSelect(shiftDay(date, weeks * 7))
      }, SLIDE_MS)
    }
  }

  return (
    <div
      ref={strip}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="touch-pan-y overflow-hidden select-none"
    >
      <div
        className="flex w-[300%]"
        style={{
          transform: `translateX(calc(-100% / 3 + ${offset.px}px))`,
          transition: offset.animate ? SLIDE_TRANSITION : 'none',
        }}
      >
        {[-1, 0, 1].map((weeks) => (
          <ol
            key={weeks}
            aria-label={weeks === 0 ? 'Week' : undefined}
            aria-hidden={weeks === 0 ? undefined : true}
            inert={weeks !== 0}
            className="grid w-1/3 grid-cols-7 gap-[5px] px-px sm:gap-2.5"
          >
            {weekOf(parseDay(shiftDay(isoDay(monday), weeks * 7))).map((day) => (
              <li key={day.getTime()}>
                <Day
                  day={day}
                  selected={isoDay(day) === date}
                  today={today}
                  summaries={summaries}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ol>
        ))}
      </div>
    </div>
  )
}
