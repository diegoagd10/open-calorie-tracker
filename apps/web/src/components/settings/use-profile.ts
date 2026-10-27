import type { Profile } from '@open-calorie-tracker/shared'
import { useEffect, useState } from 'react'

const PROFILE_URL = '/api/profile'

type Result = { profile: Profile } | 'unauthorized' | 'failed'

const request = async (): Promise<Result> => {
  try {
    const response = await fetch(PROFILE_URL, { cache: 'no-store' })
    if (response.status === 401) return 'unauthorized'
    if (!response.ok) return 'failed'
    return { profile: (await response.json()) as Profile }
  } catch {
    return 'failed'
  }
}

// Loads the logged-in user's profile. `profile` is undefined until it loads, and stays so when
// loading fails.
export const useProfile = () => {
  const [profile, setProfile] = useState<Profile>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    void request().then((result) => {
      if (!current) return
      // The session expired: a full navigation lets the proxy clear it and show the login page.
      if (result === 'unauthorized') window.location.assign('/login')
      else if (result === 'failed') setFailed(true)
      else setProfile(result.profile)
    })
    return () => {
      current = false
    }
  }, [])

  return { profile, failed }
}
