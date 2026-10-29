import type { DailyLog } from '@open-calorie-tracker/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Today } from './use-today'

type LoadResult = { log: DailyLog } | 'unauthorized' | 'failed'

const requestDailyLog = async ({ date, timeZone }: Today): Promise<LoadResult> => {
  try {
    const response = await fetch(`/api/daily-log?${new URLSearchParams({ date, timeZone })}`, {
      cache: 'no-store',
    })
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return 'failed'
    return { log: (await response.json()) as DailyLog }
  } catch {
    return 'failed'
  }
}

// Loads the log of the given day. A failed reload keeps the log that was already shown.
export const useDailyLog = (today: Today | null) => {
  const [log, setLog] = useState<DailyLog>()
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)

  const date = today?.date
  const timeZone = today?.timeZone

  const apply = useCallback((result: LoadResult) => {
    // The session expired: a full navigation lets the proxy clear it and show the login page.
    if (result === 'unauthorized') {
      window.location.assign('/login')
      return
    }
    setFailed(result === 'failed')
    if (result !== 'failed') setLog(result.log)
  }, [])

  useEffect(() => {
    if (date === undefined || timeZone === undefined) return
    const requests = generation
    const request = ++requests.current
    void requestDailyLog({ date, timeZone }).then((result) => {
      if (request === requests.current) apply(result)
    })
    return () => {
      // Invalidates initial loads AND reloads, including stale errors and redirects.
      requests.current++
    }
  }, [date, timeZone, apply])

  const reload = useCallback(async () => {
    if (date === undefined || timeZone === undefined) return
    const request = ++generation.current
    const result = await requestDailyLog({ date, timeZone })
    if (request === generation.current) apply(result)
  }, [date, timeZone, apply])

  return { log, failed, reload }
}
