import type { WeightGoal, WeightGoalUpdate } from '@open-calorie-tracker/shared'
import { useEffect, useRef, useState } from 'react'

const WEIGHT_GOAL_URL = '/api/weight-goal'

type Result = { goal: WeightGoal | null } | 'unauthorized' | 'failed'

const request = async (init?: RequestInit): Promise<Result> => {
  try {
    const response = await fetch(WEIGHT_GOAL_URL, { cache: 'no-store', ...init })
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return 'failed'
    return { goal: (await response.json()) as WeightGoal | null }
  } catch {
    return 'failed'
  }
}

// The session expired: a full navigation lets the proxy clear it and show the login page.
const logInAgain = () => window.location.assign('/login')

// Loads the user's weight goal and saves it, one save at a time. `goal` is undefined until it
// loads, and stays so when loading fails; it is null for a user without one.
export const useWeightGoal = () => {
  const [goal, setGoal] = useState<WeightGoal | null>()
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const running = useRef(false)

  useEffect(() => {
    let current = true
    void request().then((result) => {
      if (!current) return
      if (result === 'unauthorized') logInAgain()
      else if (result === 'failed') setFailed(true)
      else setGoal(result.goal)
    })
    return () => {
      current = false
    }
  }, [])

  // Resolves to the saved goal, or undefined when saving failed.
  const save = async (update: WeightGoalUpdate): Promise<WeightGoal | undefined> => {
    if (running.current) return undefined
    running.current = true
    setSaving(true)
    setFailed(false)
    const result = await request({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
    })
    if (result === 'unauthorized') {
      logInAgain()
      return undefined
    }
    running.current = false
    setSaving(false)
    if (result === 'failed' || result.goal === null) {
      setFailed(true)
      return undefined
    }
    setGoal(result.goal)
    return result.goal
  }

  return { goal, failed, saving, save }
}
