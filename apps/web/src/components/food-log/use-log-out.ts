import { useCallback, useState } from 'react'

const requestLogOut = async () => {
  try {
    return (await fetch('/api/logout', { method: 'POST' })).ok
  } catch {
    return false
  }
}

// Deletes the session and leaves for /login. Replacing the history entry keeps the Back button
// from bringing the Food Log back. A failed request leaves the page as it was.
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
