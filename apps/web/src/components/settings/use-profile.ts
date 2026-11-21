import type { Profile } from '@open-calorie-tracker/shared'
import { useEffect, useState } from 'react'
import { logInAgain } from '../requests'

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

export const useProfile = () => {
  const [profile, setProfile] = useState<Profile>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    void request().then((result) => {
      if (!current) return
      if (result === 'unauthorized') logInAgain()
      else if (result === 'failed') setFailed(true)
      else setProfile(result.profile)
    })
    return () => {
      current = false
    }
  }, [])

  return { profile, failed }
}
