import { useCallback, useState } from 'react'

const requestLogOut = async () => {
  try {
    return (await fetch('/api/logout', { method: 'POST' })).ok
  } catch {
    return false
  }
}

export const useLogOut = () => {
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const logOut = useCallback(async () => {
    setPending(true)
    setFailed(false)
    if (await requestLogOut()) {
      window.location.replace('/login')
      return
    }
    setFailed(true)
    setPending(false)
  }, [])

  return { logOut, pending, failed }
}
