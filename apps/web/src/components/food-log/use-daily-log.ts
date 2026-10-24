import type { DailyLog } from '@open-calorie-tracker/shared'
import { useCallback, useEffect, useState } from 'react'
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
    let current = true
    void requestDailyLog({ date, timeZone }).then((result) => {
      if (current) apply(result)
    })
    return () => {
      current = false
    }
  }, [date, timeZone, apply])

  const reload = useCallback(async () => {
    if (date === undefined || timeZone === undefined) return
    apply(await requestDailyLog({ date, timeZone }))
  }, [date, timeZone, apply])

  return { log, failed, reload }
}
