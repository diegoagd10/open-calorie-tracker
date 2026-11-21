import type { DailyGoals, DailyGoalsUpdate } from '@open-calorie-tracker/shared'
import { useEffect, useRef, useState } from 'react'
import { logInAgain } from '../requests'

const DAILY_GOALS_URL = '/api/daily-goals'

type Result = { goals: DailyGoals } | 'unauthorized' | 'failed'

const request = async (init?: RequestInit): Promise<Result> => {
  try {
    const response = await fetch(DAILY_GOALS_URL, { cache: 'no-store', ...init })
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return 'failed'
    return { goals: (await response.json()) as DailyGoals }
  } catch {
    return 'failed'
  }
}

export const useDailyGoals = () => {
  const [goals, setGoals] = useState<DailyGoals>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const running = useRef(false)

  useEffect(() => {
    let current = true
    void request().then((result) => {
      if (!current) return
      if (result === 'unauthorized') logInAgain()
      else if (result === 'failed') setFailed(true)
      else setGoals(result.goals)
    })
    return () => {
      current = false
    }
  }, [])

  const save = async (changes: DailyGoalsUpdate): Promise<DailyGoals | undefined> => {
    if (running.current) return undefined
    running.current = true
    setSaving(true)
    setFailed(false)
    const result = await request({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    })
    if (result === 'unauthorized') {
      logInAgain()
      return undefined
    }
    running.current = false
    setSaving(false)
    if (result === 'failed') {
      setFailed(true)
      return undefined
    }
    setGoals(result.goals)
    return result.goals
  }

  return { goals, failed, saving, save }
}
