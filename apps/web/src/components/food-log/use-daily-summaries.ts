import type { DailySummaries, DaySummary } from '@open-calorie-tracker/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { parseDay, weekOf } from './format'
import { shiftDay } from './selected-day'
import type { Today } from './use-today'

export type WeekSummaries = { calorieGoal: number; days: Record<string, DaySummary> }

const requestSummaries = async (range: { from: string; to: string; timeZone: string }) => {
  try {
    const response = await fetch(`/api/daily-summaries?${new URLSearchParams(range)}`, {
      cache: 'no-store',
    })
    return response.ok ? ((await response.json()) as DailySummaries) : undefined
  } catch {
    return undefined
  }
}

// How each day went in the viewed week and the ones beside it, which a swipe brings into view.
// The days already loaded stay while another week loads. A failure keeps them too: the daily log
// reports errors, and a session that expired.
export const useDailySummaries = (day: Today | null) => {
  const [summaries, setSummaries] = useState<WeekSummaries>()
  const generation = useRef(0)

  const monday = day === null ? undefined : weekOf(parseDay(day.date))[0]?.toISOString()
  const from = monday === undefined ? undefined : shiftDay(monday.slice(0, 10), -7)
  const to = from === undefined ? undefined : shiftDay(from, 20)
  const timeZone = day?.timeZone

  const load = useCallback(async () => {
    if (from === undefined || to === undefined || timeZone === undefined) return
    const request = ++generation.current
    const loaded = await requestSummaries({ from, to, timeZone })
    if (request !== generation.current || loaded === undefined) return
    setSummaries((previous) => ({
      calorieGoal: loaded.goals.calories,
      days: {
        ...previous?.days,
        ...Object.fromEntries(loaded.days.map((summary) => [summary.date, summary])),
      },
    }))
  }, [from, to, timeZone])

  useEffect(() => {
    void load()
  }, [load])

  return { summaries, reload: load }
}
