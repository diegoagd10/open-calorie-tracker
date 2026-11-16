import type { WeightHistory } from '@open-calorie-tracker/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sendRequest } from '@/components/requests'

type LoadResult = { history: WeightHistory } | 'unauthorized' | 'failed'

const requestHistory = async (): Promise<LoadResult> => {
  try {
    const response = await fetch('/api/weight-history', { cache: 'no-store' })
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return 'failed'
    return { history: (await response.json()) as WeightHistory }
  } catch {
    return 'failed'
  }
}

// Loads every weigh-in with the goal, and logs today's weight, one save at a time. `history` is
// undefined until it loads, and a failed reload keeps the one already shown.
export const useWeightHistory = () => {
  const [history, setHistory] = useState<WeightHistory>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const running = useRef(false)

  const apply = useCallback((result: LoadResult) => {
    // The session expired: a full navigation lets the proxy clear it and show the login page.
    if (result === 'unauthorized') window.location.assign('/login')
    else if (result === 'failed') setFailed(true)
    else setHistory(result.history)
  }, [])

  useEffect(() => {
    let current = true
    void requestHistory().then((result) => {
      if (current) apply(result)
    })
    return () => {
      current = false
    }
  }, [apply])

  // Logs the weight for today in the time zone and reloads the history. Resolves to whether it
  // was saved.
  const log = async (weight: number, timeZone: string) => {
    if (running.current) return false
    running.current = true
    setSaving(true)
    setFailed(false)
    const { outcome } = await sendRequest('POST', '/api/weight-entries', { weight, timeZone })
    if (outcome === 'unauthorized') return false
    if (outcome === 'saved') apply(await requestHistory())
    else setFailed(true)
    running.current = false
    setSaving(false)
    return outcome === 'saved'
  }

  return { history, failed, saving, log }
}
