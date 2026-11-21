import type { ApiKey } from '@open-calorie-tracker/shared'
import { useEffect, useState } from 'react'
import { logInAgain } from '../../requests'

export const API_KEYS_URL = '/api/api-keys'

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
        if (response.status === 401) logInAgain()
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
