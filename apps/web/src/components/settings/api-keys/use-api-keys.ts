import type { ApiKey } from '@open-calorie-tracker/shared'
import { useEffect, useState } from 'react'

export const API_KEYS_URL = '/api/api-keys'

// Loads the user's keys, newest first. `keys` is undefined until they load, and stays so when
// loading fails. Keys created or deleted on the page are added or dropped without a reload.
// `loadedAt` is the timestamp the dates on the page count from, e.g. "Last used 2 hours ago".
export const useApiKeys = () => {
  const [keys, setKeys] = useState<ApiKey[]>()
  const [loadedAt, setLoadedAt] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let current = true
    const load = async () => {
      try {
        const response = await fetch(API_KEYS_URL, { cache: 'no-store' })
        if (!current) return
        // The session expired: a full navigation lets the proxy clear it and show the login page.
        if (response.status === 401) window.location.assign('/login')
        else if (!response.ok) setFailed(true)
        else {
          setKeys((await response.json()) as ApiKey[])
          setLoadedAt(Date.now())
        }
      } catch {
        if (current) setFailed(true)
      }
    }
    void load()
    return () => {
      current = false
    }
  }, [])

  const add = (key: ApiKey) => setKeys((current) => [key, ...(current ?? [])])

  const drop = (id: number) => setKeys((current) => current?.filter((key) => key.id !== id))

  return { keys, loadedAt, failed, add, drop }
}
